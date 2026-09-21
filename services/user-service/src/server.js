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
        service: "user-service",
        status: "OK"
    });
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
        console.error(error);

        res.status(500).json({
            error: "Internal server error"
        });
    }
});

app.listen(3001, () => {
    console.log("User Service running on port 3001");
});