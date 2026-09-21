require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3009;

const PAYMENT_SERVICE_URL =
    process.env.PAYMENT_SERVICE_URL ||
    "http://localhost:3007";

const NOTIFICATION_SERVICE_URL =
    process.env.NOTIFICATION_SERVICE_URL ||
    "http://localhost:3008";

const MAX_RETRIES =
    Number(process.env.MAX_RETRIES) || 3;

const RETRY_DELAY_MS =
    Number(process.env.RETRY_DELAY_MS) || 1000;

/* =========================================================
   POSTGRESQL
========================================================= */

const pool = new Pool({
    host: process.env.POSTGRES_HOST || "localhost",
    port: process.env.POSTGRES_PORT || 5432,
    user: process.env.POSTGRES_USER || "scamshield",
    password: process.env.POSTGRES_PASSWORD || "scamshield",
    database: process.env.POSTGRES_DB || "scamshield"
});

/* =========================================================
   SAGA STATES
========================================================= */

const SAGA_STATES = {
    STARTED: "STARTED",

    PAYMENT_PROCESSING: "PAYMENT_PROCESSING",

    PAYMENT_SUCCESS: "PAYMENT_SUCCESS",

    PAYMENT_FAILED: "PAYMENT_FAILED",

    NOTIFICATION_PROCESSING:
        "NOTIFICATION_PROCESSING",

    NOTIFICATION_SENT:
        "NOTIFICATION_SENT",

    NOTIFICATION_FAILED:
        "NOTIFICATION_FAILED",

    RETRYING_NOTIFICATION:
        "RETRYING_NOTIFICATION",

    COMPENSATING:
        "COMPENSATING",

    COMPENSATED:
        "COMPENSATED",

    COMPLETED:
        "COMPLETED",

    FAILED:
        "FAILED"
};

/* =========================================================
   IN-MEMORY SAGA CACHE
========================================================= */

const sagas = {};

/* =========================================================
   DELAY
========================================================= */

function delay(ms) {
    return new Promise(resolve =>
        setTimeout(resolve, ms)
    );
}

/* =========================================================
   CREATE SAGA IN DATABASE
========================================================= */

async function createSagaInDatabase(saga) {

    const result = await pool.query(
        `
        INSERT INTO saga_executions
        (
            transaction_id,
            amount,
            saga_status,
            payment_status,
            notification_status,
            created_at,
            updated_at,
            completed_at
        )
        VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
        `,
        [
            saga.transactionId,
            saga.amount,
            saga.sagaStatus,
            saga.paymentStatus,
            saga.notificationStatus,
            saga.createdAt,
            saga.updatedAt,
            saga.completedAt
        ]
    );

    return result.rows[0];
}

/* =========================================================
   UPDATE SAGA IN DATABASE
========================================================= */

async function updateSagaInDatabase(saga) {

    const result = await pool.query(
        `
        UPDATE saga_executions
        SET
            saga_status = $1,
            payment_status = $2,
            notification_status = $3,
            updated_at = $4,
            completed_at = $5
        WHERE transaction_id = $6
        RETURNING *
        `,
        [
            saga.sagaStatus,
            saga.paymentStatus,
            saga.notificationStatus,
            saga.updatedAt,
            saga.completedAt,
            saga.transactionId
        ]
    );

    return result.rows[0];
}

/* =========================================================
   UPDATE SAGA STATE
========================================================= */

async function updateSagaState(
    transactionId,
    newState
) {

    const saga = sagas[transactionId];

    if (!saga) {
        return false;
    }

    saga.sagaStatus = newState;

    saga.updatedAt =
        new Date().toISOString();

    if (
        newState === SAGA_STATES.COMPLETED ||
        newState === SAGA_STATES.COMPENSATED ||
        newState === SAGA_STATES.FAILED
    ) {

        saga.completedAt =
            new Date().toISOString();
    }

    await updateSagaInDatabase(saga);

    console.log(
        `[SAGA STATE] ${transactionId} -> ${newState}`
    );

    console.log(
        `[SAGA DB] ${transactionId} -> ${newState}`
    );

    return true;
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/health", async (req, res) => {

    try {

        await pool.query("SELECT 1");

        return res.json({
            service: "saga-manager",
            status: "OK",
            database: "CONNECTED"
        });

    } catch (error) {

        console.error(
            "SAGA database health check failed:",
            error.message
        );

        return res.status(500).json({
            service: "saga-manager",
            status: "ERROR",
            database: "DISCONNECTED",
            details: error.message
        });
    }
});

/* =========================================================
   GET ALL SAGA EXECUTIONS
========================================================= */

app.get("/saga", async (req, res) => {

    try {

        const result = await pool.query(
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
            ORDER BY created_at DESC
            `
        );

        return res.json({
            count: result.rows.length,
            sagas: result.rows
        });

    } catch (error) {

        console.error(
            "Failed to fetch SAGA executions:",
            error.message
        );

        return res.status(500).json({
            error: "Failed to fetch SAGA executions",
            details: error.message,
            code: error.code
        });
    }
});

/* =========================================================
   START SAGA
========================================================= */

app.post("/saga/start", async (req, res) => {

    try {

        const {
            transactionId,
            amount
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
           MEMORY DUPLICATE CHECK
        ------------------------------------------------ */

        if (sagas[transactionId]) {

            return res.status(409).json({
                error:
                    "SAGA already exists",
                saga:
                    sagas[transactionId]
            });
        }

        /* -----------------------------------------------
           DATABASE DUPLICATE CHECK
        ------------------------------------------------ */

        const existingSaga =
            await pool.query(
                `
                SELECT *
                FROM saga_executions
                WHERE transaction_id = $1
                LIMIT 1
                `,
                [transactionId]
            );

        if (existingSaga.rows.length > 0) {

            return res.status(409).json({
                error:
                    "SAGA already exists",
                saga:
                    existingSaga.rows[0]
            });
        }

        /* -----------------------------------------------
           CREATE SAGA
        ------------------------------------------------ */

        const now =
            new Date().toISOString();

        const saga = {

            transactionId,

            amount,

            sagaStatus:
                SAGA_STATES.STARTED,

            paymentStatus: null,

            notificationStatus: null,

            createdAt: now,

            updatedAt: now,

            completedAt: null,

            retryCount: 0
        };

        sagas[transactionId] = saga;

        /* -----------------------------------------------
           SAVE SAGA
        ------------------------------------------------ */

        const savedSaga =
            await createSagaInDatabase(saga);

        console.log(
            "SAGA saved to PostgreSQL:",
            transactionId
        );

        console.log(
            "Database SAGA ID:",
            savedSaga.id
        );

        /* -----------------------------------------------
           START ASYNC WORKFLOW
        ------------------------------------------------ */

        processSaga(transactionId)
            .catch(error => {

                console.error(
                    `[SAGA] Workflow failed for ${transactionId}:`,
                    error.message
                );
            });

        return res.status(202).json({

            transactionId,

            amount,

            sagaStatus:
                SAGA_STATES.STARTED,

            message:
                "SAGA execution started"
        });

    } catch (error) {

        console.error(
            "SAGA creation error:",
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
                "SAGA creation failed",

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
   SAGA WORKFLOW
========================================================= */

async function processSaga(transactionId) {

    const saga =
        sagas[transactionId];

    if (!saga) {
        return;
    }

    try {

        /* =================================================
           STEP 1 — PAYMENT
        ================================================= */

        await updateSagaState(
            transactionId,
            SAGA_STATES.PAYMENT_PROCESSING
        );

        const paymentResponse =
            await fetch(
                `${PAYMENT_SERVICE_URL}/payments`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        transactionId:
                            saga.transactionId,

                        amount:
                            saga.amount
                    })
                }
            );

        const paymentData =
            await paymentResponse.json();

        if (!paymentResponse.ok) {

            saga.paymentStatus =
                paymentData.status ||
                SAGA_STATES.PAYMENT_FAILED;

            await updateSagaState(
                transactionId,
                SAGA_STATES.PAYMENT_FAILED
            );

            return;
        }

        /* =================================================
           STEP 2 — WAIT FOR PAYMENT
        ================================================= */

        let paymentStatus = null;

        for (let i = 0; i < 10; i++) {

            await delay(500);

            const statusResponse =
                await fetch(
                    `${PAYMENT_SERVICE_URL}/payments/${transactionId}`
                );

            const statusData =
                await statusResponse.json();

            paymentStatus =
                statusData.status;

            saga.paymentStatus =
                paymentStatus;

            if (
                paymentStatus ===
                "PAYMENT_SUCCESS"
            ) {
                break;
            }

            if (
                paymentStatus ===
                "PAYMENT_FAILED"
            ) {
                break;
            }
        }

        /* =================================================
           STEP 3 — PAYMENT FAILED
        ================================================= */

        if (
            paymentStatus !==
            "PAYMENT_SUCCESS"
        ) {

            saga.paymentStatus =
                paymentStatus ||
                SAGA_STATES.PAYMENT_FAILED;

            await updateSagaState(
                transactionId,
                SAGA_STATES.PAYMENT_FAILED
            );

            return;
        }

        /* =================================================
           STEP 4 — PAYMENT SUCCESS
        ================================================= */

        saga.paymentStatus =
            SAGA_STATES.PAYMENT_SUCCESS;

        await updateSagaState(
            transactionId,
            SAGA_STATES.PAYMENT_SUCCESS
        );

        /* =================================================
           STEP 5 — NOTIFICATION
        ================================================= */

        await updateSagaState(
            transactionId,
            SAGA_STATES.NOTIFICATION_PROCESSING
        );

        let notificationSuccess =
            false;

        for (
            let attempt = 1;
            attempt <= MAX_RETRIES;
            attempt++
        ) {

            saga.retryCount = attempt;

            if (attempt > 1) {

                await updateSagaState(
                    transactionId,
                    SAGA_STATES.RETRYING_NOTIFICATION
                );

                await delay(
                    RETRY_DELAY_MS
                );
            }

            const notificationResponse =
                await fetch(
                    `${NOTIFICATION_SERVICE_URL}/notifications`,
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({

                            transactionId:
                                saga.transactionId,

                            notificationType:
                                "PAYMENT_SUCCESS",

                            paymentStatus:
                                "PAYMENT_SUCCESS",

                            message:
                                "Payment completed successfully",

                            simulateFailure:
                                false
                        })
                    }
                );

            const notificationData =
                await notificationResponse.json();

            if (
                notificationResponse.ok
            ) {

                saga.notificationStatus =
                    SAGA_STATES.NOTIFICATION_PROCESSING;

                await updateSagaInDatabase(
                    saga
                );

                /* -----------------------------------------
                   WAIT FOR NOTIFICATION
                ------------------------------------------ */

                await delay(1000);

                const statusResponse =
                    await fetch(
                        `${NOTIFICATION_SERVICE_URL}/notifications/${transactionId}`
                    );

                const statusData =
                    await statusResponse.json();

                saga.notificationStatus =
                    statusData.status;

                await updateSagaInDatabase(
                    saga
                );

                if (
                    statusData.status ===
                    "NOTIFICATION_SENT"
                ) {

                    notificationSuccess =
                        true;

                    break;
                }
            }

            saga.notificationStatus =
                SAGA_STATES.NOTIFICATION_FAILED;

            await updateSagaInDatabase(
                saga
            );
        }

        /* =================================================
           STEP 6 — NOTIFICATION SUCCESS
        ================================================= */

        if (notificationSuccess) {

            saga.notificationStatus =
                SAGA_STATES.NOTIFICATION_SENT;

            await updateSagaState(
                transactionId,
                SAGA_STATES.NOTIFICATION_SENT
            );

            await updateSagaState(
                transactionId,
                SAGA_STATES.COMPLETED
            );

            console.log(
                `[SAGA COMPLETED] ${transactionId}`
            );

            return;
        }

        /* =================================================
           STEP 7 — NOTIFICATION FAILED
           COMPENSATE PAYMENT
        ================================================= */

        saga.notificationStatus =
            SAGA_STATES.NOTIFICATION_FAILED;

        await updateSagaState(
            transactionId,
            SAGA_STATES.NOTIFICATION_FAILED
        );

        await updateSagaState(
            transactionId,
            SAGA_STATES.COMPENSATING
        );

        const compensationResponse =
            await fetch(
                `${PAYMENT_SERVICE_URL}/payments/${transactionId}/cancel`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    }
                }
            );

        const compensationData =
            await compensationResponse.json();

        if (
            compensationResponse.ok &&
            compensationData.status ===
                "PAYMENT_COMPENSATED"
        ) {

            saga.paymentStatus =
                SAGA_STATES.COMPENSATED;

            await updateSagaState(
                transactionId,
                SAGA_STATES.COMPENSATED
            );

            console.log(
                `[SAGA COMPENSATED] ${transactionId}`
            );

            return;
        }

        /* =================================================
           COMPENSATION FAILED
        ================================================= */

        await updateSagaState(
            transactionId,
            SAGA_STATES.FAILED
        );

    } catch (error) {

        console.error(
            `[SAGA ERROR] ${transactionId}:`,
            error.message
        );

        /* -----------------------------------------------
           TRY COMPENSATION
        ------------------------------------------------ */

        try {

            if (
                saga.paymentStatus ===
                "PAYMENT_SUCCESS"
            ) {

                await updateSagaState(
                    transactionId,
                    SAGA_STATES.COMPENSATING
                );

                const compensationResponse =
                    await fetch(
                        `${PAYMENT_SERVICE_URL}/payments/${transactionId}/cancel`,
                        {
                            method: "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            }
                        }
                    );

                if (
                    compensationResponse.ok
                ) {

                    saga.paymentStatus =
                        SAGA_STATES.COMPENSATED;

                    await updateSagaState(
                        transactionId,
                        SAGA_STATES.COMPENSATED
                    );

                    return;
                }
            }

        } catch (compensationError) {

            console.error(
                `[SAGA COMPENSATION ERROR] ${transactionId}:`,
                compensationError.message
            );
        }

        await updateSagaState(
            transactionId,
            SAGA_STATES.FAILED
        );
    }
}

/* =========================================================
   GET SAGA BY TRANSACTION ID
========================================================= */

app.get(
    "/saga/:transactionId",
    async (req, res) => {

        try {

            const {
                transactionId
            } = req.params;

            /* -------------------------------------------
               MEMORY
            -------------------------------------------- */

            const saga =
                sagas[transactionId];

            if (saga) {

                return res.json({

                    transactionId:
                        saga.transactionId,

                    amount:
                        saga.amount,

                    sagaStatus:
                        saga.sagaStatus,

                    paymentStatus:
                        saga.paymentStatus,

                    notificationStatus:
                        saga.notificationStatus,

                    retryCount:
                        saga.retryCount,

                    createdAt:
                        saga.createdAt,

                    updatedAt:
                        saga.updatedAt,

                    completedAt:
                        saga.completedAt
                });
            }

            /* -------------------------------------------
               DATABASE
            -------------------------------------------- */

            const result =
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
                    ORDER BY id DESC
                    LIMIT 1
                    `,
                    [transactionId]
                );

            if (result.rows.length === 0) {

                return res.status(404).json({

                    error:
                        "SAGA not found",

                    transactionId
                });
            }

            const databaseSaga =
                result.rows[0];

            return res.json({

                id:
                    databaseSaga.id,

                transactionId:
                    databaseSaga.transaction_id,

                amount:
                    databaseSaga.amount,

                sagaStatus:
                    databaseSaga.saga_status,

                paymentStatus:
                    databaseSaga.payment_status,

                notificationStatus:
                    databaseSaga.notification_status,

                createdAt:
                    databaseSaga.created_at,

                updatedAt:
                    databaseSaga.updated_at,

                completedAt:
                    databaseSaga.completed_at
            });

        } catch (error) {

            console.error(
                "Failed to fetch SAGA:",
                error.message
            );

            return res.status(500).json({

                error:
                    "Failed to fetch SAGA",

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
                `SAGA Manager running on port ${PORT}`
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
