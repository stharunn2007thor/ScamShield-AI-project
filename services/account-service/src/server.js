const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
    host: process.env.POSTGRES_HOST || "localhost",
    port: process.env.POSTGRES_PORT || 5432,
    user: process.env.POSTGRES_USER || "scamshield",
    password: process.env.POSTGRES_PASSWORD || "scamshield",
    database: process.env.POSTGRES_DB || "scamshield"
});

// Health check
app.get("/health", (req, res) => {
    res.json({
        service: "account-service",
        status: "OK"
    });
});

// Get account
app.get("/accounts/:accountId", async (req, res) => {
    try {
        const { accountId } = req.params;

        const result = await pool.query(
            "SELECT * FROM accounts WHERE id = $1",
            [accountId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Account not found"
            });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Internal server error"
        });
    }
});

// Get account balance
app.get("/accounts/:accountId/balance", async (req, res) => {
    try {
        const { accountId } = req.params;

        const result = await pool.query(
            "SELECT balance FROM accounts WHERE id = $1",
            [accountId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Account not found"
            });
        }

        res.json({
            accountId,
            balance: result.rows[0].balance
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Internal server error"
        });
    }
});

app.listen(3002, () => {
    console.log("Account Service running on port 3002");
});