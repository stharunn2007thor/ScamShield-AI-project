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
    database: process.env.POSTGRES_DB || "scamshield",

    // PostgreSQL reliability settings
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

pool.on("error", (error) => {
    console.error("[POSTGRES] Unexpected pool error:", error);
});

// Health check
app.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            service: "user-service",
            status: "OK",
            database: "CONNECTED"
        });
    } catch (error) {
        console.error("[HEALTH] Database check failed:", error);

        res.status(503).json({
            service: "user-service",
            status: "UNAVAILABLE",
            database: "DISCONNECTED"
        });
    }
});

// Get user
app.get("/users/:userId", async (req, res) => {
    try {
        const { userId } = req.params;

        const result = await pool.query(
            "SELECT * FROM users WHERE id = $1",
            [userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "User not found"
            });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error("[GET USER]", error);

        res.status(500).json({
            error: "Internal server error"
        });
    }
});

// Dynamic port for local + cloud deployment
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log(`User Service running on port ${PORT}`);
});