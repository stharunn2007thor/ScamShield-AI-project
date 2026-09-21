require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const { Kafka } = require("kafkajs");
const { createClient } = require("redis");

const app = express();

app.use(express.json());

/* =========================================================
   CORS - DASHBOARD
========================================================= */

app.use((req, res, next) => {

    res.header(
        "Access-Control-Allow-Origin",
        "http://localhost:5173"
    );

    res.header(
        "Access-Control-Allow-Methods",
        "GET,POST,PUT,DELETE,OPTIONS"
    );

    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
});

const PORT = process.env.PORT || 3003;


/* =========================================================
   REDIS - RATE LIMITER
========================================================= */

const redisClient = createClient({
    socket: {
        host: process.env.REDIS_HOST || "localhost",
        port: Number(process.env.REDIS_PORT || 6379)
    }
});

redisClient.on("error", (error) => {
    console.error("[REDIS] Error:", error.message);
});

const RATE_LIMIT = 10;
const RATE_WINDOW = 60;

async function connectRedis() {

    if (!redisClient.isOpen) {
        await redisClient.connect();

        console.log("[REDIS] Connected");
    }
}

async function rateLimiter(req, res, next) {

    try {

        await connectRedis();

        const ip =
            req.headers["x-forwarded-for"] ||
            req.socket.remoteAddress ||
            "unknown";

        const key =
            `rate-limit:transactions:${ip}`;

        const count =
            await redisClient.incr(key);

        if (count === 1) {

            await redisClient.expire(
                key,
                RATE_WINDOW
            );
        }

        if (count > RATE_LIMIT) {

            return res.status(429).json({

                error:
                    "Too many requests",

                message:
                    "Rate limit exceeded. Try again later.",

                limit:
                    RATE_LIMIT,

                windowSeconds:
                    RATE_WINDOW
            });
        }

        next();

    } catch (error) {

        console.error(
            "[RATE LIMITER] Error:",
            error.message
        );

        /*
         Fail open:
         If Redis temporarily fails,
         transactions can still continue.
        */

        next();
    }
}


/* =========================================================
   POSTGRESQL
========================================================= */

const pool = new Pool({

    host:
        process.env.POSTGRES_HOST ||
        "localhost",

    port:
        process.env.POSTGRES_PORT ||
        5432,

    user:
        process.env.POSTGRES_USER ||
        "scamshield",

    password:
        process.env.POSTGRES_PASSWORD ||
        "scamshield",

    database:
        process.env.POSTGRES_DB ||
        "scamshield"
});


/* =========================================================
   KAFKA
========================================================= */

const kafka = new Kafka({

    clientId:
        "transaction-service",

    brokers: [
        process.env.KAFKA_BROKER ||
        "localhost:9092"
    ]
});

const producer =
    kafka.producer();

const KAFKA_TOPIC =
    process.env.KAFKA_TRANSACTION_TOPIC ||
    "transaction-events";


/* =========================================================
   CREATE TRANSACTION
   RATE LIMITED
========================================================= */

app.post(
    "/transactions",
    rateLimiter,
    async (req, res) => {

        try {

            const {
                transactionId,
                userId,
                accountId,
                amount,
                merchant,
                deviceId,
                location
            } = req.body;


            /* -----------------------------------------------
               VALIDATION
            ------------------------------------------------ */

            if (!transactionId) {

                return res.status(400).json({
                    error:
                        "transactionId is required"
                });
            }

            if (!userId) {

                return res.status(400).json({
                    error:
                        "userId is required"
                });
            }

            if (!accountId) {

                return res.status(400).json({
                    error:
                        "accountId is required"
                });
            }

            if (
                typeof amount !== "number" ||
                amount <= 0
            ) {

                return res.status(400).json({
                    error:
                        "amount must be greater than 0"
                });
            }


            /* -----------------------------------------------
               USER CHECK
            ------------------------------------------------ */

            const userResult =
                await pool.query(
                    `
                    SELECT id
                    FROM users
                    WHERE id = $1
                    `,
                    [userId]
                );

            if (
                userResult.rows.length === 0
            ) {

                return res.status(404).json({

                    error:
                        "User not found",

                    userId
                });
            }


            /* -----------------------------------------------
               ACCOUNT CHECK
            ------------------------------------------------ */

            const accountResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        user_id,
                        balance,
                        status
                    FROM accounts
                    WHERE id = $1
                    `,
                    [accountId]
                );

            if (
                accountResult.rows.length === 0
            ) {

                return res.status(404).json({

                    error:
                        "Account not found",

                    accountId
                });
            }

            const account =
                accountResult.rows[0];


            /* -----------------------------------------------
               ACCOUNT OWNERSHIP
            ------------------------------------------------ */

            if (
                account.user_id !== userId
            ) {

                return res.status(400).json({

                    error:
                        "Account does not belong to user"
                });
            }


            /* -----------------------------------------------
               ACCOUNT STATUS
            ------------------------------------------------ */

            if (
                account.status !== "ACTIVE"
            ) {

                return res.status(400).json({

                    error:
                        "Account is not active"
                });
            }


            /* -----------------------------------------------
               BALANCE CHECK
            ------------------------------------------------ */

            if (
                Number(account.balance) <
                amount
            ) {

                return res.status(400).json({

                    error:
                        "Insufficient account balance"
                });
            }


            /* -----------------------------------------------
               DUPLICATE TRANSACTION CHECK
            ------------------------------------------------ */

            const existingTransaction =
                await pool.query(
                    `
                    SELECT *
                    FROM transactions
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [transactionId]
                );

            if (
                existingTransaction.rows.length > 0
            ) {

                return res.status(409).json({

                    error:
                        "Transaction already exists",

                    transaction:
                        existingTransaction.rows[0]
                });
            }


            /* -----------------------------------------------
               INSERT TRANSACTION
            ------------------------------------------------ */

            const transactionResult =
                await pool.query(
                    `
                    INSERT INTO transactions
                    (
                        id,
                        user_id,
                        account_id,
                        amount,
                        merchant,
                        device_id,
                        location,
                        status
                    )
                    VALUES
                    ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING *
                    `,
                    [
                        transactionId,
                        userId,
                        accountId,
                        amount,
                        merchant || null,
                        deviceId || null,
                        location || null,
                        "ANALYZING"
                    ]
                );

            const transaction =
                transactionResult.rows[0];


            /* -----------------------------------------------
               KAFKA PUBLISH
            ------------------------------------------------ */

            await producer.send({

                topic:
                    KAFKA_TOPIC,

                messages: [

                    {
                        key:
                            transactionId,

                        value:
                            JSON.stringify({

                                transactionId:
                                    transaction.id,

                                userId:
                                    transaction.user_id,

                                accountId:
                                    transaction.account_id,

                                amount:
                                    Number(
                                        transaction.amount
                                    ),

                                merchant:
                                    transaction.merchant,

                                deviceId:
                                    transaction.device_id,

                                location:
                                    transaction.location,

                                status:
                                    transaction.status,

                                createdAt:
                                    transaction.created_at
                            })
                    }
                ]
            });


            console.log(
                `[TRANSACTION] ${transactionId} saved and published to Kafka`
            );


            return res.status(201).json({

                transactionId:
                    transaction.id,

                userId:
                    transaction.user_id,

                accountId:
                    transaction.account_id,

                amount:
                    transaction.amount,

                merchant:
                    transaction.merchant,

                deviceId:
                    transaction.device_id,

                location:
                    transaction.location,

                status:
                    transaction.status,

                createdAt:
                    transaction.created_at,

                message:
                    "Transaction created successfully"
            });

        } catch (error) {

            console.error(
                "Transaction creation error:",
                error.message
            );

            return res.status(500).json({

                error:
                    "Failed to create transaction",

                details:
                    error.message,

                code:
                    error.code
            });
        }
    }
);


/* =========================================================
   GET ALL TRANSACTIONS
========================================================= */

app.get(
    "/transactions",
    async (req, res) => {

        try {

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        user_id,
                        account_id,
                        amount,
                        merchant,
                        device_id,
                        location,
                        status,
                        created_at
                    FROM transactions
                    ORDER BY created_at DESC
                    `
                );

            return res.json({

                count:
                    result.rows.length,

                transactions:
                    result.rows
            });

        } catch (error) {

            console.error(
                "Failed to fetch transactions:",
                error.message
            );

            return res.status(500).json({

                error:
                    "Failed to fetch transactions",

                details:
                    error.message,

                code:
                    error.code
            });
        }
    }
);


/* =========================================================
   GET TRANSACTION BY ID
========================================================= */

app.get(
    "/transactions/:transactionId",
    async (req, res) => {

        try {

            const {
                transactionId
            } = req.params;

            const result =
                await pool.query(
                    `
                    SELECT
                        id,
                        user_id,
                        account_id,
                        amount,
                        merchant,
                        device_id,
                        location,
                        status,
                        created_at
                    FROM transactions
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [transactionId]
                );

            if (
                result.rows.length === 0
            ) {

                return res.status(404).json({

                    error:
                        "Transaction not found",

                    transactionId
                });
            }

            return res.json(
                result.rows[0]
            );

        } catch (error) {

            console.error(
                "Failed to fetch transaction:",
                error.message
            );

            return res.status(500).json({

                error:
                    "Failed to fetch transaction",

                details:
                    error.message,

                code:
                    error.code
            });
        }
    }
);


/* =========================================================
   TRANSACTION HISTORY API
========================================================= */

app.get(
    "/transactions/:transactionId/history",
    async (req, res) => {

        try {

            const {
                transactionId
            } = req.params;


            /* -------------------------------------------
               1. TRANSACTION
            -------------------------------------------- */

            const transactionResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        user_id,
                        account_id,
                        amount,
                        merchant,
                        device_id,
                        location,
                        status,
                        created_at
                    FROM transactions
                    WHERE id = $1
                    LIMIT 1
                    `,
                    [transactionId]
                );

            if (
                transactionResult.rows.length === 0
            ) {

                return res.status(404).json({

                    error:
                        "Transaction not found",

                    transactionId
                });
            }


            /* -------------------------------------------
               2. RISK DECISIONS
            -------------------------------------------- */

            const riskResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        transaction_id,
                        risk_score,
                        risk_level,
                        decision,
                        next_action,
                        created_at
                    FROM risk_decisions
                    WHERE transaction_id = $1
                    ORDER BY created_at ASC
                    `,
                    [transactionId]
                );


            /* -------------------------------------------
               3. PAYMENTS
            -------------------------------------------- */

            const paymentResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        transaction_id,
                        amount,
                        status,
                        simulate_failure,
                        created_at,
                        updated_at,
                        completed_at
                    FROM payments
                    WHERE transaction_id = $1
                    ORDER BY created_at ASC
                    `,
                    [transactionId]
                );


            /* -------------------------------------------
               4. NOTIFICATIONS
            -------------------------------------------- */

            const notificationResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        transaction_id,
                        notification_type,
                        payment_status,
                        message,
                        status,
                        simulate_failure,
                        retry_count,
                        created_at,
                        updated_at,
                        completed_at
                    FROM notifications
                    WHERE transaction_id = $1
                    ORDER BY created_at ASC
                    `,
                    [transactionId]
                );


            /* -------------------------------------------
               5. SAGA
            -------------------------------------------- */

            const sagaResult =
                await pool.query(
                    `
                    SELECT
                        id,
                        transaction_id,
                        amount,
                        saga_status,
                        payment_status,
                        notification_status,
                        created_at,
                        updated_at,
                        completed_at
                    FROM saga_executions
                    WHERE transaction_id = $1
                    ORDER BY created_at ASC
                    `,
                    [transactionId]
                );


            /* -------------------------------------------
               RESPONSE
            -------------------------------------------- */

            return res.json({

                transaction:
                    transactionResult.rows[0],

                riskDecisions:
                    riskResult.rows,

                payments:
                    paymentResult.rows,

                notifications:
                    notificationResult.rows,

                sagaExecutions:
                    sagaResult.rows
            });

        } catch (error) {

            console.error(
                "Failed to fetch transaction history:",
                error.message
            );

            return res.status(500).json({

                error:
                    "Failed to fetch transaction history",

                details:
                    error.message,

                code:
                    error.code
            });
        }
    }
);


/* =========================================================
   DASHBOARD SUMMARY API
========================================================= */

app.get(
    "/dashboard/summary",
    async (req, res) => {

        try {


            /* -------------------------------------------
               TRANSACTION COUNTS
            -------------------------------------------- */

            const transactionResult =
                await pool.query(
                    `
                    SELECT
                        COUNT(*) AS total_transactions,

                        COUNT(*) FILTER (
                            WHERE status = 'APPROVED'
                        ) AS approved,

                        COUNT(*) FILTER (
                            WHERE status IN (
                                'PENDING',
                                'PENDING_OTP',
                                'HOLD'
                            )
                        ) AS pending,

                        COUNT(*) FILTER (
                            WHERE status IN (
                                'BLOCKED',
                                'REJECTED'
                            )
                        ) AS blocked

                    FROM transactions
                    `
                );


            /* -------------------------------------------
               RISK DECISION COUNTS
            -------------------------------------------- */

            const decisionResult =
                await pool.query(
                    `
                    SELECT
                        COUNT(*) FILTER (
                            WHERE decision = 'APPROVED'
                        ) AS approved,

                        COUNT(*) FILTER (
                            WHERE decision IN (
                                'PENDING_OTP',
                                'HOLD'
                            )
                        ) AS pending,

                        COUNT(*) FILTER (
                            WHERE decision = 'BLOCKED'
                        ) AS blocked

                    FROM risk_decisions
                    `
                );


            /* -------------------------------------------
               PAYMENT COUNTS
            -------------------------------------------- */

            const paymentResult =
                await pool.query(
                    `
                    SELECT
                        COUNT(*) FILTER (
                            WHERE status = 'PAYMENT_SUCCESS'
                        ) AS payment_success,

                        COUNT(*) FILTER (
                            WHERE status = 'PAYMENT_FAILED'
                        ) AS payment_failed,

                        COUNT(*) FILTER (
                            WHERE status = 'PAYMENT_COMPENSATED'
                        ) AS payment_compensated

                    FROM payments
                    `
                );


            /* -------------------------------------------
               NOTIFICATION COUNTS
            -------------------------------------------- */

            const notificationResult =
                await pool.query(
                    `
                    SELECT
                        COUNT(*) FILTER (
                            WHERE status = 'NOTIFICATION_SENT'
                        ) AS notification_sent,

                        COUNT(*) FILTER (
                            WHERE status = 'NOTIFICATION_FAILED'
                        ) AS notification_failed

                    FROM notifications
                    `
                );


            /* -------------------------------------------
               SAGA COUNTS
            -------------------------------------------- */

            const sagaResult =
                await pool.query(
                    `
                    SELECT
                        COUNT(*) FILTER (
                            WHERE saga_status = 'COMPLETED'
                        ) AS completed,

                        COUNT(*) FILTER (
                            WHERE saga_status IN (
                                'STARTED',
                                'PAYMENT_PROCESSING',
                                'NOTIFICATION_PROCESSING',
                                'RETRYING_NOTIFICATION',
                                'COMPENSATING'
                            )
                        ) AS processing,

                        COUNT(*) FILTER (
                            WHERE saga_status = 'COMPENSATED'
                        ) AS compensated,

                        COUNT(*) FILTER (
                            WHERE saga_status = 'FAILED'
                        ) AS failed

                    FROM saga_executions
                    `
                );


            /* -------------------------------------------
               RECENT TRANSACTIONS
            -------------------------------------------- */

            const recentResult =
                await pool.query(
                    `
                    SELECT
                        t.id,
                        t.user_id,
                        t.amount,
                        t.merchant,
                        t.location,
                        t.status,
                        t.created_at,

                        rd.risk_score,
                        rd.risk_level,
                        rd.decision,
                        rd.next_action

                    FROM transactions t

                    LEFT JOIN LATERAL (
                        SELECT
                            risk_score,
                            risk_level,
                            decision,
                            next_action
                        FROM risk_decisions
                        WHERE transaction_id = t.id
                        ORDER BY created_at DESC
                        LIMIT 1
                    ) rd ON TRUE

                    ORDER BY t.created_at DESC
                    LIMIT 10
                    `
                );


            /* -------------------------------------------
               RESPONSE
            -------------------------------------------- */

            return res.json({

                transactions: {

                    total:
                        Number(
                            transactionResult.rows[0]
                                .total_transactions
                        ),

                    approved:
                        Number(
                            transactionResult.rows[0]
                                .approved
                        ),

                    pending:
                        Number(
                            transactionResult.rows[0]
                                .pending
                        ),

                    blocked:
                        Number(
                            transactionResult.rows[0]
                                .blocked
                        )
                },

                decisions: {

                    approved:
                        Number(
                            decisionResult.rows[0]
                                .approved
                        ),

                    pending:
                        Number(
                            decisionResult.rows[0]
                                .pending
                        ),

                    blocked:
                        Number(
                            decisionResult.rows[0]
                                .blocked
                        )
                },

                payments: {

                    success:
                        Number(
                            paymentResult.rows[0]
                                .payment_success
                        ),

                    failed:
                        Number(
                            paymentResult.rows[0]
                                .payment_failed
                        ),

                    compensated:
                        Number(
                            paymentResult.rows[0]
                                .payment_compensated
                        )
                },

                notifications: {

                    sent:
                        Number(
                            notificationResult.rows[0]
                                .notification_sent
                        ),

                    failed:
                        Number(
                            notificationResult.rows[0]
                                .notification_failed
                        )
                },

                saga: {

                    completed:
                        Number(
                            sagaResult.rows[0]
                                .completed
                        ),

                    processing:
                        Number(
                            sagaResult.rows[0]
                                .processing
                        ),

                    compensated:
                        Number(
                            sagaResult.rows[0]
                                .compensated
                        ),

                    failed:
                        Number(
                            sagaResult.rows[0]
                                .failed
                        )
                },

                recentTransactions:
                    recentResult.rows
            });

        } catch (error) {

            console.error(
                "Dashboard summary error:",
                error.message
            );

            return res.status(500).json({

                error:
                    "Failed to fetch dashboard summary",

                details:
                    error.message,

                code:
                    error.code
            });
        }
    }
);


/* =========================================================
   START SERVER
========================================================= */

const startServer = async () => {

    try {

        /* -------------------------------------------
           DATABASE
        -------------------------------------------- */

        await pool.query("SELECT 1");

        console.log(
            "PostgreSQL connected"
        );


        /* -------------------------------------------
           REDIS
        -------------------------------------------- */

        await connectRedis();


        /* -------------------------------------------
           KAFKA
        -------------------------------------------- */

        await producer.connect();

        console.log(
            "Kafka producer connected"
        );


        /* -------------------------------------------
           SERVER
        -------------------------------------------- */

        app.listen(
            PORT,
            () => {

                console.log(
                    `Transaction Service running on port ${PORT}`
                );

                console.log(
                    "Rate Limiting: ENABLED"
                );

                console.log(
                    `Rate Limit: ${RATE_LIMIT} requests / ${RATE_WINDOW} seconds`
                );
            }
        );

    } catch (error) {

        console.error(
            "Failed to start Transaction Service:"
        );

        console.error(
            error.message
        );

        process.exit(1);
    }
};

startServer();