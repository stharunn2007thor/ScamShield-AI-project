require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3006;

const SAGA_MANAGER_URL =
    process.env.SAGA_MANAGER_URL || "http://localhost:3009";

// ===============================
// PostgreSQL
// ===============================

const pool = new Pool({
    host: process.env.POSTGRES_HOST || "localhost",
    port: process.env.POSTGRES_PORT || 5432,
    user: process.env.POSTGRES_USER || "scamshield",
    password: process.env.POSTGRES_PASSWORD || "scamshield",
    database: process.env.POSTGRES_DB || "scamshield"
});

// ===============================
// Health Check
// ===============================

app.get("/health", (req, res) => {

    res.json({
        service: "risk-decision-service",
        status: "OK"
    });

});

// ===============================
// Risk Decision History
// ===============================

// Get all risk decisions
app.get("/decisions", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                id,
                transaction_id,
                risk_score,
                risk_level,
                decision,
                next_action,
                created_at
            FROM risk_decisions
            ORDER BY created_at DESC
        `);

        return res.status(200).json({
            count: result.rows.length,
            decisions: result.rows
        });

    } catch (error) {

        console.error(
            "Failed to fetch risk decisions:",
            error.message
        );

        return res.status(500).json({
            error: "Failed to fetch risk decisions"
        });

    }

});

// Get risk decision by transaction ID
app.get("/decisions/:transactionId", async (req, res) => {

    try {

        const { transactionId } = req.params;

        const result = await pool.query(
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
            ORDER BY created_at DESC
            `,
            [transactionId]
        );

        if (result.rows.length === 0) {

            return res.status(404).json({
                error: "Risk decision not found"
            });

        }

        return res.status(200).json({
            count: result.rows.length,
            decisions: result.rows
        });

    } catch (error) {

        console.error(
            "Failed to fetch risk decision:",
            error.message
        );

        return res.status(500).json({
            error: "Failed to fetch risk decision"
        });

    }

});

// ===============================
// Risk Decision
// ===============================

app.post("/decision", async (req, res) => {

    try {

        const {
            transactionId,
            riskScore,
            riskLevel,
            amount
        } = req.body;

        // ===============================
        // Validate Transaction ID
        // ===============================

        if (!transactionId) {

            return res.status(400).json({
                error: "transactionId is required"
            });

        }

        // ===============================
        // Validate Risk Score
        // ===============================

        if (
            typeof riskScore !== "number" ||
            riskScore < 0 ||
            riskScore > 100
        ) {

            return res.status(400).json({
                error:
                    "riskScore must be a number between 0 and 100"
            });

        }

        // ===============================
        // Determine Decision
        // ===============================

        let decision;
        let nextAction;

        if (riskScore <= 40) {

            decision = "APPROVED";
            nextAction = "START_SAGA";

        } else if (riskScore <= 75) {

            decision = "PENDING_OTP";
            nextAction = "REQUIRE_OTP";

        } else {

            decision = "BLOCKED";
            nextAction = "CREATE_REVIEW_QUEUE";

        }

        // ===============================
        // Save Risk Decision
        // ===============================

        const decisionResult = await pool.query(
            `
            INSERT INTO risk_decisions
            (
                transaction_id,
                risk_score,
                risk_level,
                decision,
                next_action
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            `,
            [
                transactionId,
                riskScore,
                riskLevel || null,
                decision,
                nextAction
            ]
        );

        const savedDecision = decisionResult.rows[0];

        console.log(
            "Risk decision saved to PostgreSQL:",
            savedDecision.id
        );

        // ===============================
        // Start SAGA for Approved Payment
        // ===============================

        let sagaResult = null;

        if (decision === "APPROVED") {

            if (
                typeof amount !== "number" ||
                amount <= 0
            ) {

                return res.status(400).json({
                    error:
                        "amount is required for approved transactions"
                });

            }

            console.log("Starting SAGA...");

            const sagaResponse = await fetch(
                `${SAGA_MANAGER_URL}/saga/start`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        transactionId,
                        amount
                    })
                }
            );

            if (!sagaResponse.ok) {

                throw new Error(
                    "SAGA Manager failed"
                );

            }

            sagaResult = await sagaResponse.json();

            console.log(
                "SAGA Status:",
                sagaResult.sagaStatus
            );

        }

        // ===============================
        // Response
        // ===============================

        return res.json({

            transactionId,

            riskScore,

            riskLevel,

            decision,

            nextAction,

            database: {
                saved: true,
                decisionId: savedDecision.id
            },

            saga: sagaResult

        });

    } catch (error) {

        console.error(
            "Risk decision error:",
            error.message
        );

        return res.status(500).json({
            error: "Internal server error"
        });

    }

});

// ===============================
// Start Server
// ===============================

const startServer = async () => {

    try {

        // Test PostgreSQL connection
        await pool.query("SELECT 1");

        console.log(
            "PostgreSQL connected"
        );

        app.listen(PORT, () => {

            console.log(
                `Risk Decision Service running on port ${PORT}`
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