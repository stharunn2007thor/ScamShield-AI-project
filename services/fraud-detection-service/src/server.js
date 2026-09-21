const express = require("express");
const { Kafka } = require("kafkajs");
const { createClient } = require("redis");
const { evaluateRules } = require("./rules");
const { analyzeGraph } = require("./graph");

require("dotenv").config();

const app = express();

app.use(express.json());

// ===============================
// Analysis Result Store
// ===============================

const analysisResults = new Map();

// Get analysis result by transaction ID
app.get("/results/:transactionId", (req, res) => {
    const transactionId = req.params.transactionId;

    const result = analysisResults.get(transactionId);

    if (!result) {
        return res.status(404).json({
            error: "Transaction analysis not found",
            transactionId: transactionId
        });
    }

    res.json(result);
});

// ===============================
// Configuration
// ===============================

const PORT = process.env.PORT || 3004;

const KAFKA_BROKER =
    process.env.KAFKA_BROKER || "localhost:9092";

const KAFKA_TOPIC =
    process.env.KAFKA_TOPIC || "transaction-events";

const KAFKA_GROUP =
    process.env.KAFKA_GROUP || "fraud-detection-group-v2";

const REDIS_HOST =
    process.env.REDIS_HOST || "localhost";

const REDIS_PORT =
    process.env.REDIS_PORT || 6379;

const ML_SERVICE_URL =
    process.env.ML_SERVICE_URL || "http://localhost:5000";

const RISK_ENGINE_URL =
    process.env.RISK_ENGINE_URL || "http://localhost:3005";

const RISK_ENGINE_API_KEY =
    process.env.RISK_ENGINE_API_KEY;

// ===============================
// Kafka
// ===============================

const kafka = new Kafka({
    clientId: "fraud-detection-service",
    brokers: [KAFKA_BROKER]
});

const consumer = kafka.consumer({
    groupId: KAFKA_GROUP
});

// ===============================
// Redis
// ===============================

const redisClient = createClient({
    socket: {
        host: REDIS_HOST,
        port: Number(REDIS_PORT)
    }
});

redisClient.on("error", (error) => {
    console.error("Redis Error:", error);
});

// ===============================
// Health Check
// ===============================

app.get("/health", (req, res) => {
    res.json({
        service: "fraud-detection-service",
        status: "OK"
    });
});

// ===============================
// Redis Behaviour Analysis
// ===============================

const trackUserVelocity = async (userId) => {

    const key = `velocity:${userId}`;

    const count = await redisClient.incr(key);

    if (count === 1) {
        await redisClient.expire(key, 300);
    }

    return count;
};

// ===============================
// ML Fraud Prediction
// ===============================

const getMLPrediction = async (
    transaction,
    velocity
) => {

    const mlPayload = {

        amount:
            Number(transaction.amount),

        velocity:
            velocity,

        device_change:
            transaction.deviceId !==
            transaction.registeredDevice
                ? 1
                : 0,

        location_change:
            transaction.location !==
            transaction.registeredLocation
                ? 1
                : 0,

        transaction_frequency:
            velocity,

        merchant_category:
            transaction.merchant || "OTHER"
    };

    console.log(
        "Sending data to ML Service:"
    );

    console.log(mlPayload);

    const response =
        await fetch(
            `${ML_SERVICE_URL}/predict`,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(mlPayload)
            }
        );

    if (!response.ok) {

        throw new Error(
            `ML service returned status ${response.status}`
        );

    }

    const result =
        await response.json();

    return result;
};

// ===============================
// Risk Scoring
// ===============================

const getRiskScore = async (
    transaction,
    ruleResult,
    mlResult,
    graphResult
) => {

    const riskPayload = {

        transactionId:
            transaction.transactionId,

        amount:
            Number(transaction.amount),

        ruleScore:
            ruleResult.ruleScore,

        fraudProbability:
            mlResult.fraudProbability,

        graphRisk:
            graphResult.graphRisk
    };

    console.log(
        "Sending data to Risk Engine:"
    );

    console.log(riskPayload);

    // ===============================
    // Security Check
    // ===============================

    if (!RISK_ENGINE_API_KEY) {

        throw new Error(
            "RISK_ENGINE_API_KEY is not configured"
        );

    }

    const response =
        await fetch(
            `${RISK_ENGINE_URL}/risk-score`,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": RISK_ENGINE_API_KEY
                },

                body:
                    JSON.stringify(riskPayload)
            }
        );

    if (!response.ok) {

        const errorText =
            await response.text();

        throw new Error(
            `Risk Engine returned status ${response.status}: ${errorText}`
        );

    }

    const result =
        await response.json();

    return result;
};

// ===============================
// Kafka Consumer
// ===============================

const startConsumer = async () => {

    try {

        // ===============================
        // Connect Redis
        // ===============================

        await redisClient.connect();

        console.log(
            "Redis connected"
        );

        // ===============================
        // Connect Kafka
        // ===============================

        await consumer.connect();

        console.log(
            "Kafka consumer connected"
        );

        // ===============================
        // Subscribe to Topic
        // ===============================

        await consumer.subscribe({

            topic:
                KAFKA_TOPIC,

            fromBeginning:
                false

        });

        console.log(
            `Subscribed to Kafka topic: ${KAFKA_TOPIC}`
        );

        // ===============================
        // Start Consumer
        // ===============================

        await consumer.run({

            eachMessage: async ({
                topic,
                partition,
                message
            }) => {

                try {

                    // ===============================
                    // Parse Kafka Message
                    // ===============================

                    const transaction =
                        JSON.parse(
                            message.value.toString()
                        );

                    console.log(
                        "\n================================"
                    );

                    console.log(
                        "TRANSACTION EVENT RECEIVED"
                    );

                    console.log(
                        "================================"
                    );

                    console.log(
                        "Topic:",
                        topic
                    );

                    console.log(
                        "Partition:",
                        partition
                    );

                    console.log(
                        "Transaction:",
                        transaction
                    );

                    // ===============================
                    // Redis Velocity Analysis
                    // ===============================

                    const velocity =
                        await trackUserVelocity(
                            transaction.userId
                        );

                    console.log(
                        "Transactions in last 5 minutes:",
                        velocity
                    );

                    console.log(
                        "Redis Key:",
                        `velocity:${transaction.userId}`
                    );

                    // ===============================
                    // Rule Engine
                    // ===============================

                    const ruleResult =
                        evaluateRules(
                            transaction,
                            velocity
                        );

                    console.log(
                        "Rule Score:",
                        ruleResult.ruleScore
                    );

                    console.log(
                        "Rules Triggered:",
                        ruleResult.rulesTriggered
                    );

                    // ===============================
                    // Graph Fraud Detection
                    // ===============================

                    const graphResult =
                        await analyzeGraph(
                            transaction,
                            redisClient
                        );

                    console.log(
                        "Graph Risk:",
                        graphResult.graphRisk
                    );

                    console.log(
                        "Graph Signals:",
                        graphResult.graphSignals
                    );

                    // ===============================
                    // ML Fraud Prediction
                    // ===============================

                    const mlResult =
                        await getMLPrediction(
                            transaction,
                            velocity
                        );

                    console.log(
                        "ML Fraud Probability:",
                        mlResult.fraudProbability
                    );

                    // ===============================
                    // Risk Scoring
                    // ===============================

                    const riskResult =
                        await getRiskScore(
                            transaction,
                            ruleResult,
                            mlResult,
                            graphResult
                        );

                    console.log(
                        "Final Risk Score:",
                        riskResult.riskScore
                    );

                    console.log(
                        "Risk Level:",
                        riskResult.riskLevel
                    );

                    console.log(
                        "Decision:",
                        riskResult.decision
                    );

                    console.log(
                        "Next Action:",
                        riskResult.nextAction
                    );

                    // ===============================
                    // Final Fraud Analysis
                    // ===============================

                    const analysisResult = {

                        transactionId:
                            transaction.transactionId,

                        userId:
                            transaction.userId,

                        amount:
                            Number(transaction.amount),

                        ruleScore:
                            ruleResult.ruleScore,

                        rulesTriggered:
                            ruleResult.rulesTriggered,

                        graphRisk:
                            graphResult.graphRisk,

                        graphSignals:
                            graphResult.graphSignals,

                        fraudProbability:
                            mlResult.fraudProbability,

                        mlScore:
                            riskResult.mlScore,

                        riskScore:
                            riskResult.riskScore,

                        riskLevel:
                            riskResult.riskLevel,

                        decision:
                            riskResult.decision,

                        nextAction:
                            riskResult.nextAction,

                        saga:
                            riskResult.saga || null
                    };

                    // ===============================
                    // Store Result
                    // ===============================

                    analysisResults.set(
                        transaction.transactionId,
                        analysisResult
                    );

                    // ===============================
                    // Display Final Result
                    // ===============================

                    console.log(
                        "\n========== FINAL FRAUD ANALYSIS =========="
                    );

                    console.log(
                        JSON.stringify(
                            analysisResult,
                            null,
                            2
                        )
                    );

                    console.log(
                        "=========================================="
                    );

                    console.log(
                        "Analysis result stored for:",
                        transaction.transactionId
                    );

                    console.log(
                        "==========================================\n"
                    );

                } catch (error) {

                    console.error(
                        "Failed to process Kafka message:",
                        error.message
                    );

                    console.error(error.stack);

                }

            }

        });

    } catch (error) {

        console.error(
            "Fraud Detection Service failed:"
        );

        console.error(error);

        process.exit(1);

    }

};

// ===============================
// Start Server
// ===============================

app.listen(PORT, () => {

    console.log(
        `Fraud Detection Service running on port ${PORT}`
    );

    console.log(
        `ML Service URL: ${ML_SERVICE_URL}`
    );

    console.log(
        `Risk Engine URL: ${RISK_ENGINE_URL}`
    );

    console.log(
        "Risk Engine API Key: " +
        (RISK_ENGINE_API_KEY
            ? "CONFIGURED"
            : "MISSING")
    );

    startConsumer();

});