require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3008;

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
   NOTIFICATION STATES
========================================================= */

const NOTIFICATION_STATES = {
    PENDING: "NOTIFICATION_PENDING",
    SENT: "NOTIFICATION_SENT",
    FAILED: "NOTIFICATION_FAILED"
};

/* =========================================================
   IN-MEMORY CACHE
========================================================= */

const notifications = {};

/* =========================================================
   VALID NOTIFICATION TYPES
========================================================= */

const VALID_NOTIFICATION_TYPES = [
    "PAYMENT_SUCCESS",
    "PAYMENT_FAILED",
    "PAYMENT_COMPENSATED",
    "SAGA_COMPLETED",
    "SAGA_COMPENSATED"
];

/* =========================================================
   SAVE NOTIFICATION TO DATABASE
========================================================= */

async function saveNotificationToDatabase(notification) {

    const result = await pool.query(
        `
        INSERT INTO notifications
        (
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
        )
        VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
        `,
        [
            notification.transactionId,
            notification.notificationType,
            notification.paymentStatus,
            notification.message,
            notification.status,
            notification.simulateFailure,
            notification.retryCount,
            notification.createdAt,
            notification.updatedAt,
            notification.completedAt
        ]
    );

    return result.rows[0];
}

/* =========================================================
   UPDATE NOTIFICATION IN DATABASE
========================================================= */

async function updateNotificationInDatabase(
    transactionId,
    status,
    retryCount,
    updatedAt,
    completedAt
) {

    const result = await pool.query(
        `
        UPDATE notifications
        SET
            status = $1,
            retry_count = $2,
            updated_at = $3,
            completed_at = $4
        WHERE transaction_id = $5
        RETURNING *
        `,
        [
            status,
            retryCount,
            updatedAt,
            completedAt,
            transactionId
        ]
    );

    return result.rows[0];
}

/* =========================================================
   UPDATE NOTIFICATION STATE
========================================================= */

async function updateNotificationState(
    transactionId,
    newState
) {

    const notification =
        notifications[transactionId];

    if (!notification) {
        return false;
    }

    notification.status = newState;

    notification.updatedAt =
        new Date().toISOString();

    if (newState === NOTIFICATION_STATES.SENT) {

        notification.completedAt =
            new Date().toISOString();
    }

    if (newState === NOTIFICATION_STATES.FAILED) {

        notification.completedAt =
            new Date().toISOString();
    }

    await updateNotificationInDatabase(
        transactionId,
        notification.status,
        notification.retryCount,
        notification.updatedAt,
        notification.completedAt
    );

    console.log(
        `[NOTIFICATION STATE] ${transactionId} -> ${newState}`
    );

    console.log(
        `[NOTIFICATION DB] ${transactionId} -> ${newState}`
    );

    return true;
}

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/health", async (req, res) => {

    try {

        await pool.query("SELECT 1");

        return res.json({
            service: "notification-service",
            status: "OK",
            database: "CONNECTED"
        });

    } catch (error) {

        console.error(
            "Notification database health check failed:",
            error.message
        );

        return res.status(500).json({
            service: "notification-service",
            status: "ERROR",
            database: "DISCONNECTED",
            details: error.message
        });
    }
});

/* =========================================================
   GET ALL NOTIFICATIONS
========================================================= */

app.get("/notifications", async (req, res) => {

    try {

        const result = await pool.query(
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
            ORDER BY created_at DESC
            `
        );

        return res.json({
            count: result.rows.length,
            notifications: result.rows
        });

    } catch (error) {

        console.error(
            "Failed to fetch notifications:",
            error.message
        );

        return res.status(500).json({
            error: "Failed to fetch notifications",
            details: error.message,
            code: error.code
        });
    }
});

/* =========================================================
   CREATE NOTIFICATION
========================================================= */

app.post("/notifications", async (req, res) => {

    try {

        const {
            transactionId,
            notificationType,
            paymentStatus,
            message,
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

        if (!notificationType) {

            return res.status(400).json({
                error: "notificationType is required"
            });
        }

        if (
            !VALID_NOTIFICATION_TYPES.includes(
                notificationType
            )
        ) {

            return res.status(400).json({
                error: "Invalid notificationType",
                allowedTypes:
                    VALID_NOTIFICATION_TYPES
            });
        }

        /* -----------------------------------------------
           DUPLICATE CHECK - MEMORY
        ------------------------------------------------ */

        if (notifications[transactionId]) {

            return res.status(409).json({
                error: "Notification already exists",
                notification:
                    notifications[transactionId]
            });
        }

        /* -----------------------------------------------
           DUPLICATE CHECK - DATABASE
        ------------------------------------------------ */

        const existingNotification =
            await pool.query(
                `
                SELECT *
                FROM notifications
                WHERE transaction_id = $1
                LIMIT 1
                `,
                [transactionId]
            );

        if (existingNotification.rows.length > 0) {

            return res.status(409).json({
                error: "Notification already exists",
                notification:
                    existingNotification.rows[0]
            });
        }

        /* -----------------------------------------------
           CREATE NOTIFICATION
        ------------------------------------------------ */

        const now =
            new Date().toISOString();

        const notification = {

            transactionId,

            notificationType,

            paymentStatus:
                paymentStatus || null,

            message:
                message ||
                `Transaction ${transactionId} status: ${notificationType}`,

            status:
                NOTIFICATION_STATES.PENDING,

            simulateFailure,

            retryCount: 0,

            createdAt: now,

            updatedAt: now,

            completedAt: null
        };

        /* -----------------------------------------------
           STORE IN MEMORY
        ------------------------------------------------ */

        notifications[transactionId] =
            notification;

        /* -----------------------------------------------
           STORE IN DATABASE
        ------------------------------------------------ */

        const savedNotification =
            await saveNotificationToDatabase(
                notification
            );

        console.log(
            "Notification saved to PostgreSQL:",
            transactionId
        );

        console.log(
            "Database Notification ID:",
            savedNotification.id
        );

        /* -----------------------------------------------
           LOG
        ------------------------------------------------ */

        console.log(
            "================================"
        );

        console.log(
            "NOTIFICATION REQUEST"
        );

        console.log(
            "================================"
        );

        console.log(
            "Transaction ID:",
            transactionId
        );

        console.log(
            "Notification Type:",
            notificationType
        );

        console.log(
            "Payment Status:",
            paymentStatus
        );

        console.log(
            "Notification Status:",
            NOTIFICATION_STATES.PENDING
        );

        /* -----------------------------------------------
           PROCESS NOTIFICATION
        ------------------------------------------------ */

        setTimeout(async () => {

            try {

                /* ---------------------------------------
                   FAILURE SIMULATION
                ---------------------------------------- */

                if (simulateFailure === true) {

                    await updateNotificationState(
                        transactionId,
                        NOTIFICATION_STATES.FAILED
                    );

                    console.log(
                        `[NOTIFICATION] ${transactionId} -> NOTIFICATION_FAILED`
                    );

                    return;
                }

                /* ---------------------------------------
                   SUCCESS
                ---------------------------------------- */

                await updateNotificationState(
                    transactionId,
                    NOTIFICATION_STATES.SENT
                );

                console.log(
                    `[NOTIFICATION] ${transactionId} -> NOTIFICATION_SENT`
                );

            } catch (error) {

                console.error(
                    `[NOTIFICATION] Database update failed for ${transactionId}:`,
                    error.message
                );

                console.error(
                    "PostgreSQL error code:",
                    error.code
                );
            }

        }, 500);

        /* -----------------------------------------------
           RESPONSE
        ------------------------------------------------ */

        return res.status(202).json({

            transactionId,

            notificationType,

            paymentStatus,

            status:
                NOTIFICATION_STATES.PENDING,

            retryCount: 0,

            message:
                "Notification processing started"
        });

    } catch (error) {

        console.error(
            "Notification creation error:",
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
                "Notification creation failed",

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
   GET NOTIFICATION BY TRANSACTION ID
========================================================= */

app.get(
    "/notifications/:transactionId",
    async (req, res) => {

        try {

            const {
                transactionId
            } = req.params;

            /* -------------------------------------------
               CHECK MEMORY
            -------------------------------------------- */

            const notification =
                notifications[transactionId];

            if (notification) {

                return res.json({

                    transactionId:
                        notification.transactionId,

                    notificationType:
                        notification.notificationType,

                    paymentStatus:
                        notification.paymentStatus,

                    message:
                        notification.message,

                    status:
                        notification.status,

                    simulateFailure:
                        notification.simulateFailure,

                    retryCount:
                        notification.retryCount,

                    createdAt:
                        notification.createdAt,

                    updatedAt:
                        notification.updatedAt,

                    completedAt:
                        notification.completedAt
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
                    LIMIT 1
                    `,
                    [transactionId]
                );

            if (result.rows.length === 0) {

                return res.status(404).json({

                    error:
                        "Notification not found",

                    transactionId
                });
            }

            const databaseNotification =
                result.rows[0];

            return res.json({

                transactionId:
                    databaseNotification.transaction_id,

                notificationType:
                    databaseNotification.notification_type,

                paymentStatus:
                    databaseNotification.payment_status,

                message:
                    databaseNotification.message,

                status:
                    databaseNotification.status,

                simulateFailure:
                    databaseNotification.simulate_failure,

                retryCount:
                    databaseNotification.retry_count,

                createdAt:
                    databaseNotification.created_at,

                updatedAt:
                    databaseNotification.updated_at,

                completedAt:
                    databaseNotification.completed_at
            });

        } catch (error) {

            console.error(
                "Failed to fetch notification:",
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
   RETRY NOTIFICATION
========================================================= */

app.post(
    "/notifications/:transactionId/retry",
    async (req, res) => {

        try {

            const {
                transactionId
            } = req.params;

            let notification =
                notifications[transactionId];

            /* -------------------------------------------
               LOAD FROM DATABASE
            -------------------------------------------- */

            if (!notification) {

                const result =
                    await pool.query(
                        `
                        SELECT *
                        FROM notifications
                        WHERE transaction_id = $1
                        LIMIT 1
                        `,
                        [transactionId]
                    );

                if (result.rows.length === 0) {

                    return res.status(404).json({

                        error:
                            "Notification not found",

                        transactionId
                    });
                }

                const databaseNotification =
                    result.rows[0];

                notification = {

                    transactionId:
                        databaseNotification.transaction_id,

                    notificationType:
                        databaseNotification.notification_type,

                    paymentStatus:
                        databaseNotification.payment_status,

                    message:
                        databaseNotification.message,

                    status:
                        databaseNotification.status,

                    simulateFailure:
                        databaseNotification.simulate_failure,

                    retryCount:
                        databaseNotification.retry_count,

                    createdAt:
                        databaseNotification.created_at,

                    updatedAt:
                        databaseNotification.updated_at,

                    completedAt:
                        databaseNotification.completed_at
                };

                notifications[transactionId] =
                    notification;
            }

            /* -------------------------------------------
               ONLY FAILED NOTIFICATIONS CAN RETRY
            -------------------------------------------- */

            if (
                notification.status !==
                NOTIFICATION_STATES.FAILED
            ) {

                return res.status(400).json({

                    transactionId,

                    status:
                        notification.status,

                    error:
                        "Only failed notifications can be retried"
                });
            }

            /* -------------------------------------------
               INCREMENT RETRY COUNT
            -------------------------------------------- */

            notification.retryCount += 1;

            notification.status =
                NOTIFICATION_STATES.PENDING;

            notification.updatedAt =
                new Date().toISOString();

            notification.completedAt = null;

            await updateNotificationInDatabase(
                transactionId,
                notification.status,
                notification.retryCount,
                notification.updatedAt,
                notification.completedAt
            );

            console.log(
                `[NOTIFICATION RETRY] ${transactionId} -> Attempt ${notification.retryCount}`
            );

            /* -------------------------------------------
               PROCESS RETRY
            -------------------------------------------- */

            setTimeout(async () => {

                try {

                    if (
                        notification.simulateFailure === true
                    ) {

                        await updateNotificationState(
                            transactionId,
                            NOTIFICATION_STATES.FAILED
                        );

                        console.log(
                            `[NOTIFICATION RETRY] ${transactionId} -> FAILED`
                        );

                        return;
                    }

                    await updateNotificationState(
                        transactionId,
                        NOTIFICATION_STATES.SENT
                    );

                    console.log(
                        `[NOTIFICATION RETRY] ${transactionId} -> SENT`
                    );

                } catch (error) {

                    console.error(
                        `[NOTIFICATION RETRY] Database update failed for ${transactionId}:`,
                        error.message
                    );

                    console.error(
                        "PostgreSQL error code:",
                        error.code
                    );
                }

            }, 500);

            return res.status(202).json({

                transactionId,

                status:
                    NOTIFICATION_STATES.PENDING,

                retryCount:
                    notification.retryCount,

                message:
                    "Notification retry started"
            });

        } catch (error) {

            console.error(
                "Notification retry error:",
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
                `Notification Service running on port ${PORT}`
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