require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3007;

/* =========================================================
   POSTGRESQL CONNECTION
========================================================= */

const pool = new Pool({
    host: process.env.POSTGRES_HOST || "localhost",
    port: process.env.POSTGRES_PORT || 5432,
    user: process.env.POSTGRES_USER || "scamshield",
    password: process.env.POSTGRES_PASSWORD || "scamshield",
    database: process.env.POSTGRES_DB || "scamshield"
});

/* =========================================================
   PAYMENT STATES
========================================================= */

const PAYMENT_STATES = {
    PROCESSING: "PAYMENT_PROCESSING",
    SUCCESS: "PAYMENT_SUCCESS",
    FAILED: "PAYMENT_FAILED",
    COMPENSATED: "PAYMENT_COMPENSATED"
};

/* =========================================================
   IN-MEMORY PAYMENT CACHE
========================================================= */

const payments = {};

/* =========================================================
   SAVE PAYMENT TO DATABASE
========================================================= */

async function savePaymentToDatabase(payment) {

    const result = await pool.query(
        `
        INSERT INTO payments
        (
            transaction_id,
            amount,
            status,
            simulate_failure,
            created_at,
            updated_at,
            completed_at
        )
        VALUES
        ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
        `,
        [
            payment.transactionId,
            payment.amount,
            payment.status,
            payment.simulateFailure,
            payment.createdAt,
            payment.updatedAt,
            payment.completedAt
        ]
    );

    return result.rows[0];
}

/* =========================================================
   UPDATE PAYMENT IN DATABASE
========================================================= */

async function updatePaymentInDatabase(
    transactionId,
    status,
    updatedAt,
    completedAt
) {

    const result = await pool.query(
        `
        UPDATE payments
        SET
            status = $1,
            updated_at = $2,
            completed_at = $3
        WHERE transaction_id = $4
        RETURNING *
        `,
        [
            status,
            updatedAt,
            completedAt,
            transactionId
        ]
    );

    return result.rows[0];
}

/* =========================================================
   UPDATE PAYMENT STATE
========================================================= */

async function updatePaymentState(
    transactionId,
    newState
) {

    const payment = payments[transactionId];

    if (!payment) {
        return false;
    }

    payment.status = newState;

    payment.updatedAt =
        new Date().toISOString();

    if (
        newState === PAYMENT_STATES.SUCCESS ||
        newState === PAYMENT_STATES.FAILED ||
        newState === PAYMENT_STATES.COMPENSATED
    ) {

        payment.completedAt =
            new Date().toISOString();
    }

    await updatePaymentInDatabase(
        transactionId,
        payment.status,
        payment.updatedAt,
        payment.completedAt
    );

    console.log(
        `[PAYMENT STATE] ${transactionId} -> ${newState}`
    );

    console.log(
        `[PAYMENT DB] ${transactionId} -> ${newState}`
    );

    return true;
}

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/health", async (req, res) => {

    try {

        await pool.query("SELECT 1");

        res.json({
            service: "payment-service",
            status: "OK",
            database: "CONNECTED"
        });

    } catch (error) {

        console.error(
            "Payment database health check failed:",
            error.message
        );

        res.status(500).json({
            service: "payment-service",
            status: "ERROR",
            database: "DISCONNECTED",
            details: error.message
        });
    }
});

/* =========================================================
   GET ALL PAYMENTS
========================================================= */

app.get("/payments", async (req, res) => {

    try {

        const result = await pool.query(
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
            ORDER BY created_at DESC
            `
        );

        return res.status(200).json({
            count: result.rows.length,
            payments: result.rows
        });

    } catch (error) {

        console.error(
            "Failed to fetch payments:",
            error.message
        );

        return res.status(500).json({
            error: "Failed to fetch payments",
            details: error.message,
            code: error.code
        });
    }
});

/* =========================================================
   CREATE PAYMENT
========================================================= */

app.post("/payments", async (req, res) => {

    try {

        const {
            transactionId,
            amount,
            simulateFailure = false
        } = req.body;

        /* -----------------------------------------------
           VALIDATION
        ------------------------------------------------ */

        if (!transactionId) {

            return res.status(400).json({
                error: "transactionId is required"
            });
        }

        if (
            typeof amount !== "number" ||
            amount <= 0
        ) {

            return res.status(400).json({
                error: "amount must be greater than 0"
            });
        }

        /* -----------------------------------------------
           DUPLICATE CHECK - MEMORY
        ------------------------------------------------ */

        if (payments[transactionId]) {

            return res.status(409).json({
                error: "Payment already exists",
                payment: payments[transactionId]
            });
        }

        /* -----------------------------------------------
           DUPLICATE CHECK - DATABASE
        ------------------------------------------------ */

        const existingPayment =
            await pool.query(
                `
                SELECT *
                FROM payments
                WHERE transaction_id = $1
                LIMIT 1
                `,
                [transactionId]
            );

        if (existingPayment.rows.length > 0) {

            return res.status(409).json({
                error: "Payment already exists",
                payment: existingPayment.rows[0]
            });
        }

        /* -----------------------------------------------
           CREATE PAYMENT OBJECT
        ------------------------------------------------ */

        const now =
            new Date().toISOString();

        const payment = {

            transactionId,

            amount,

            status:
                PAYMENT_STATES.PROCESSING,

            simulateFailure,

            createdAt: now,

            updatedAt: now,

            completedAt: null
        };

        /* -----------------------------------------------
           STORE IN MEMORY
        ------------------------------------------------ */

        payments[transactionId] = payment;

        /* -----------------------------------------------
           STORE IN DATABASE
        ------------------------------------------------ */

        const savedPayment =
            await savePaymentToDatabase(payment);

        console.log(
            "Payment saved to PostgreSQL:",
            transactionId
        );

        console.log(
            "Database Payment ID:",
            savedPayment.id
        );

        /* -----------------------------------------------
           PAYMENT LOG
        ------------------------------------------------ */

        console.log(
            "================================"
        );

        console.log(
            "PAYMENT REQUEST"
        );

        console.log(
            "================================"
        );

        console.log(
            "Transaction ID:",
            transactionId
        );

        console.log(
            "Amount:",
            amount
        );

        console.log(
            "Payment Status:",
            PAYMENT_STATES.PROCESSING
        );

        /* -----------------------------------------------
           SIMULATE PAYMENT PROCESSING
        ------------------------------------------------ */

        setTimeout(async () => {

            try {

                /* ---------------------------------------
                   FAILURE SIMULATION
                ---------------------------------------- */

                if (simulateFailure === true) {

                    await updatePaymentState(
                        transactionId,
                        PAYMENT_STATES.FAILED
                    );

                    console.log(
                        `[PAYMENT] ${transactionId} -> PAYMENT_FAILED`
                    );

                    return;
                }

                /* ---------------------------------------
                   SUCCESS
                ---------------------------------------- */

                await updatePaymentState(
                    transactionId,
                    PAYMENT_STATES.SUCCESS
                );

                console.log(
                    `[PAYMENT] ${transactionId} -> PAYMENT_SUCCESS`
                );

            } catch (error) {

                console.error(
                    `[PAYMENT] Database update failed for ${transactionId}:`,
                    error.message
                );

                console.error(
                    "PostgreSQL error code:",
                    error.code
                );
            }

        }, 1000);

        /* -----------------------------------------------
           RESPONSE
        ------------------------------------------------ */

        return res.status(202).json({

            transactionId,

            amount,

            status:
                PAYMENT_STATES.PROCESSING,

            message:
                "Payment processing started"
        });

    } catch (error) {

        console.error(
            "Payment creation error:",
            error.message
        );

        console.error(
            "PostgreSQL error code:",
            error.code
        );

        console.error(
            "PostgreSQL detail:",
            error.detail
        );

        console.error(
            "PostgreSQL constraint:",
            error.constraint
        );

        return res.status(500).json({

            error:
                "Payment creation failed",

            details:
                error.message,

            code:
                error.code,

            detail:
                error.detail || null,

            constraint:
                error.constraint || null
        });
    }
});

/* =========================================================
   GET PAYMENT BY TRANSACTION ID
========================================================= */

app.get(
    "/payments/:transactionId",
    async (req, res) => {

        try {

            const {
                transactionId
            } = req.params;

            /* -------------------------------------------
               CHECK MEMORY FIRST
            -------------------------------------------- */

            const payment =
                payments[transactionId];

            if (payment) {

                return res.json({

                    transactionId:
                        payment.transactionId,

                    amount:
                        payment.amount,

                    status:
                        payment.status,

                    simulateFailure:
                        payment.simulateFailure,

                    createdAt:
                        payment.createdAt,

                    updatedAt:
                        payment.updatedAt,

                    completedAt:
                        payment.completedAt
                });
            }

            /* -------------------------------------------
               CHECK DATABASE
            -------------------------------------------- */

            const result =
                await pool.query(
                    `
                    SELECT
                        transaction_id,
                        amount,
                        status,
                        simulate_failure,
                        created_at,
                        updated_at,
                        completed_at
                    FROM payments
                    WHERE transaction_id = $1
                    LIMIT 1
                    `,
                    [transactionId]
                );

            if (result.rows.length === 0) {

                return res.status(404).json({

                    error:
                        "Payment not found",

                    transactionId
                });
            }

            const databasePayment =
                result.rows[0];

            return res.json({

                transactionId:
                    databasePayment.transaction_id,

                amount:
                    databasePayment.amount,

                status:
                    databasePayment.status,

                simulateFailure:
                    databasePayment.simulate_failure,

                createdAt:
                    databasePayment.created_at,

                updatedAt:
                    databasePayment.updated_at,

                completedAt:
                    databasePayment.completed_at
            });

        } catch (error) {

            console.error(
                "Failed to fetch payment:",
                error.message
            );

            return res.status(500).json({

                error:
                    "Internal server error",

                details:
                    error.message,

                code:
                    error.code
            });
        }
    }
);

/* =========================================================
   COMPENSATE PAYMENT
========================================================= */

app.post(
    "/payments/:transactionId/cancel",
    async (req, res) => {

        try {

            const {
                transactionId
            } = req.params;

            let payment =
                payments[transactionId];

            /* -------------------------------------------
               LOAD FROM DATABASE IF NOT IN MEMORY
            -------------------------------------------- */

            if (!payment) {

                const result =
                    await pool.query(
                        `
                        SELECT *
                        FROM payments
                        WHERE transaction_id = $1
                        LIMIT 1
                        `,
                        [transactionId]
                    );

                if (result.rows.length === 0) {

                    return res.status(404).json({

                        error:
                            "Payment not found",

                        transactionId
                    });
                }

                const databasePayment =
                    result.rows[0];

                payment = {

                    transactionId:
                        databasePayment.transaction_id,

                    amount:
                        Number(databasePayment.amount),

                    status:
                        databasePayment.status,

                    simulateFailure:
                        databasePayment.simulate_failure,

                    createdAt:
                        databasePayment.created_at,

                    updatedAt:
                        databasePayment.updated_at,

                    completedAt:
                        databasePayment.completed_at
                };

                payments[transactionId] =
                    payment;
            }

            /* -------------------------------------------
               ALREADY COMPENSATED
            -------------------------------------------- */

            if (
                payment.status ===
                PAYMENT_STATES.COMPENSATED
            ) {

                return res.json({

                    transactionId,

                    status:
                        PAYMENT_STATES.COMPENSATED,

                    message:
                        "Payment already compensated"
                });
            }

            /* -------------------------------------------
               ONLY SUCCESSFUL PAYMENTS CAN BE
               COMPENSATED
            -------------------------------------------- */

            if (
                payment.status !==
                PAYMENT_STATES.SUCCESS
            ) {

                return res.status(400).json({

                    transactionId,

                    status:
                        payment.status,

                    error:
                        "Only successful payments can be compensated"
                });
            }

            /* -------------------------------------------
               COMPENSATE
            -------------------------------------------- */

            await updatePaymentState(
                transactionId,
                PAYMENT_STATES.COMPENSATED
            );

            console.log(
                "================================"
            );

            console.log(
                "PAYMENT COMPENSATION"
            );

            console.log(
                "================================"
            );

            console.log(
                "Transaction ID:",
                transactionId
            );

            console.log(
                "Payment Status:",
                PAYMENT_STATES.COMPENSATED
            );

            return res.json({

                transactionId,

                status:
                    PAYMENT_STATES.COMPENSATED,

                message:
                    "Payment compensation completed"
            });

        } catch (error) {

            console.error(
                "Payment compensation error:",
                error.message
            );

            console.error(
                "PostgreSQL error code:",
                error.code
            );

            return res.status(500).json({

                error:
                    "Internal server error",

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

        await pool.query("SELECT 1");

        console.log(
            "PostgreSQL connected"
        );

        app.listen(PORT, () => {

            console.log(
                `Payment Service running on port ${PORT}`
            );
        });

    } catch (error) {

        console.error(
            "Failed to connect to PostgreSQL:"
        );

        console.error(
            error.message
        );

        process.exit(1);
    }
};

startServer();