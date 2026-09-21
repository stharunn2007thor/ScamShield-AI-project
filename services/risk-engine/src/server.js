const express = require("express");
require("dotenv").config();

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3005;

const RULE_WEIGHT = Number(process.env.RULE_WEIGHT) || 0.30;
const ML_WEIGHT = Number(process.env.ML_WEIGHT) || 0.50;
const GRAPH_WEIGHT = Number(process.env.GRAPH_WEIGHT) || 0.20;

const LOW_RISK_THRESHOLD =
    Number(process.env.LOW_RISK_THRESHOLD) || 40;

const HIGH_RISK_THRESHOLD =
    Number(process.env.HIGH_RISK_THRESHOLD) || 70;

const RISK_DECISION_URL =
    process.env.RISK_DECISION_URL || "http://localhost:3006";

const INTERNAL_API_KEY =
    process.env.INTERNAL_API_KEY;


// Health check remains public
app.get("/health", (req, res) => {
    res.json({
        service: "risk-engine",
        status: "OK"
    });
});


// API key protection for risk scoring
function requireApiKey(req, res, next) {

    if (!INTERNAL_API_KEY) {
        console.error("INTERNAL_API_KEY is not configured");

        return res.status(500).json({
            error: "Server security configuration missing"
        });
    }

    const providedKey = req.headers["x-api-key"];

    if (!providedKey || providedKey !== INTERNAL_API_KEY) {
        return res.status(401).json({
            error: "Unauthorized"
        });
    }

    next();
}


app.post("/risk-score", requireApiKey, async (req, res) => {

    try {

        const {
            transactionId,
            amount,
            ruleScore,
            fraudProbability,
            graphRisk
        } = req.body;


        if (
            !transactionId ||
            amount === undefined ||
            ruleScore === undefined ||
            fraudProbability === undefined ||
            graphRisk === undefined
        ) {
            return res.status(400).json({
                error:
                    "transactionId, amount, ruleScore, fraudProbability and graphRisk are required"
            });
        }


        const amountNumber = Number(amount);
        const ruleScoreNumber = Number(ruleScore);
        const fraudProbabilityNumber = Number(fraudProbability);
        const graphRiskNumber = Number(graphRisk);


        if (
            !Number.isFinite(amountNumber) ||
            amountNumber <= 0
        ) {
            return res.status(400).json({
                error: "amount must be greater than 0"
            });
        }


        if (
            !Number.isFinite(ruleScoreNumber) ||
            ruleScoreNumber < 0 ||
            ruleScoreNumber > 100
        ) {
            return res.status(400).json({
                error: "ruleScore must be between 0 and 100"
            });
        }


        if (
            !Number.isFinite(fraudProbabilityNumber) ||
            fraudProbabilityNumber < 0 ||
            fraudProbabilityNumber > 1
        ) {
            return res.status(400).json({
                error:
                    "fraudProbability must be between 0 and 1"
            });
        }


        if (
            !Number.isFinite(graphRiskNumber) ||
            graphRiskNumber < 0 ||
            graphRiskNumber > 100
        ) {
            return res.status(400).json({
                error:
                    "graphRisk must be between 0 and 100"
            });
        }


        const mlScore =
            fraudProbabilityNumber * 100;


        const riskScore =
            (ruleScoreNumber * RULE_WEIGHT) +
            (mlScore * ML_WEIGHT) +
            (graphRiskNumber * GRAPH_WEIGHT);


        const finalRiskScore =
            Math.round(riskScore);


        let riskLevel;

        if (finalRiskScore < LOW_RISK_THRESHOLD) {
            riskLevel = "LOW";
        }
        else if (finalRiskScore < HIGH_RISK_THRESHOLD) {
            riskLevel = "MEDIUM";
        }
        else {
            riskLevel = "HIGH";
        }


        console.log("\n========== RISK CALCULATION ==========");

        console.log(
            "Transaction ID:",
            transactionId
        );

        console.log(
            "Amount:",
            amountNumber
        );

        console.log(
            "Rule Score:",
            ruleScoreNumber
        );

        console.log(
            "ML Fraud Probability:",
            fraudProbabilityNumber
        );

        console.log(
            "ML Score:",
            mlScore
        );

        console.log(
            "Graph Risk:",
            graphRiskNumber
        );

        console.log(
            "Final Risk Score:",
            finalRiskScore
        );

        console.log(
            "Risk Level:",
            riskLevel
        );

        console.log(
            "=======================================\n"
        );


        // Send result to Risk Decision Service

        const decisionResponse = await fetch(
            RISK_DECISION_URL + "/decision",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify({
                    transactionId: transactionId,
                    amount: amountNumber,
                    riskScore: finalRiskScore,
                    riskLevel: riskLevel
                })
            }
        );


        if (!decisionResponse.ok) {

            const errorText =
                await decisionResponse.text();

            console.error(
                "Risk Decision Service error:",
                errorText
            );

            return res.status(502).json({
                error:
                    "Risk Decision Service unavailable"
            });
        }


        const decision =
            await decisionResponse.json();


        res.json({

            transactionId: transactionId,

            amount: amountNumber,

            ruleScore: ruleScoreNumber,

            fraudProbability:
                fraudProbabilityNumber,

            mlScore:
                Number(mlScore.toFixed(2)),

            graphRisk:
                graphRiskNumber,

            riskScore:
                finalRiskScore,

            riskLevel:
                riskLevel,

            decision:
                decision.decision,

            nextAction:
                decision.nextAction,

            saga:
                decision.saga || null
        });


    }
    catch (error) {

        console.error(
            "Risk scoring error:",
            error.message
        );

        res.status(500).json({
            error:
                "Internal server error"
        });
    }
});


app.listen(PORT, () => {

    console.log(
        "Risk Engine running on port " + PORT
    );

    console.log(
        "Rule Weight: " + RULE_WEIGHT
    );

    console.log(
        "ML Weight: " + ML_WEIGHT
    );

    console.log(
        "Graph Weight: " + GRAPH_WEIGHT
    );

    console.log(
        "Low Risk Threshold: " +
        LOW_RISK_THRESHOLD
    );

    console.log(
        "High Risk Threshold: " +
        HIGH_RISK_THRESHOLD
    );

    console.log(
        "Risk Decision URL: " +
        RISK_DECISION_URL
    );

    console.log(
        "API key protection: ENABLED"
    );

});
