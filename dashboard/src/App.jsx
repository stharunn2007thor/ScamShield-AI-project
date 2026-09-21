import { useEffect, useState } from "react";
import "./App.css";

const API_URL = "http://localhost:3003";

function App() {
    const [dashboard, setDashboard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const fetchDashboard = async () => {
        try {
            const response = await fetch(
                `${API_URL}/dashboard/summary`
            );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            const data = await response.json();

            setDashboard(data);
            setError("");

        } catch (err) {

            console.error(
                "Dashboard API error:",
                err
            );

            setError(
                "Unable to connect to Transaction Service"
            );

        } finally {

            setLoading(false);
        }
    };

    useEffect(() => {

        fetchDashboard();

        const interval = setInterval(
            fetchDashboard,
            5000
        );

        return () => clearInterval(interval);

    }, []);

    if (loading) {

        return (
            <div className="loading-screen">
                <div className="loading-card">
                    <div className="loading-spinner"></div>
                    <h2>ScamShield AI</h2>
                    <p>
                        Connecting to monitoring system...
                    </p>
                </div>
            </div>
        );
    }

    if (error && !dashboard) {

        return (
            <div className="loading-screen">
                <div className="loading-card error-card">
                    <div className="error-icon">!</div>

                    <h2>
                        ScamShield AI
                    </h2>

                    <p>
                        {error}
                    </p>

                    <button
                        className="analyze-btn"
                        onClick={() => {
                            setLoading(true);
                            fetchDashboard();
                        }}
                    >
                        Retry Connection
                    </button>

                    <small>
                        Make sure Transaction Service
                        is running on port 3003.
                    </small>
                </div>
            </div>
        );
    }

    const transactions =
        dashboard?.transactions || {};

    const decisions =
        dashboard?.decisions || {};

    const payments =
        dashboard?.payments || {};

    const notifications =
        dashboard?.notifications || {};

    const saga =
        dashboard?.saga || {};

    const recentTransactions =
        dashboard?.recentTransactions || [];

    return (
        <div className="dashboard">

            {/* =================================================
                HEADER
            ================================================= */}

            <header className="header">

                <div className="brand">

                    <div className="brand-icon">
                        🛡
                    </div>

                    <div>
                        <h1>
                            ScamShield AI
                        </h1>

                        <p>
                            Real-Time Transaction Fraud Detection
                        </p>
                    </div>

                </div>

                <div className="system-status">

                    <span className="status-dot"></span>

                    SYSTEM ONLINE

                </div>

            </header>


            <main>

                {/* =================================================
                    LIVE STATUS
                ================================================= */}

                {error && (
                    <div className="connection-warning">
                        ⚠ Dashboard refresh temporarily unavailable
                    </div>
                )}


                {/* =================================================
                    KPI CARDS
                ================================================= */}

                <section className="stats-grid">

                    <div className="stat-card">

                        <span>
                            Total Transactions
                        </span>

                        <strong>
                            {transactions.total}
                        </strong>

                        <small>
                            PostgreSQL records
                        </small>

                    </div>


                    <div className="stat-card danger">

                        <span>
                            Blocked
                        </span>

                        <strong>
                            {decisions.blocked}
                        </strong>

                        <small>
                            High-risk transactions
                        </small>

                    </div>


                    <div className="stat-card warning">

                        <span>
                            Pending
                        </span>

                        <strong>
                            {decisions.pending}
                        </strong>

                        <small>
                            OTP / Human Review
                        </small>

                    </div>


                    <div className="stat-card success">

                        <span>
                            Approved
                        </span>

                        <strong>
                            {decisions.approved}
                        </strong>

                        <small>
                            Approved decisions
                        </small>

                    </div>

                </section>


                {/* =================================================
                    MONITORING GRID
                ================================================= */}

                <section className="monitor-grid">


                    {/* PAYMENT */}

                    <div className="monitor-card">

                        <div className="monitor-title">

                            <span>
                                Payment Processing
                            </span>

                            <span className="monitor-icon">
                                💳
                            </span>

                        </div>

                        <div className="monitor-value">
                            {payments.success}
                        </div>

                        <div className="monitor-label">
                            Successful Payments
                        </div>

                        <div className="mini-stats">

                            <div>
                                <span>
                                    Failed
                                </span>

                                <strong className="danger-text">
                                    {payments.failed}
                                </strong>
                            </div>

                            <div>
                                <span>
                                    Compensated
                                </span>

                                <strong className="warning-text">
                                    {payments.compensated}
                                </strong>
                            </div>

                        </div>

                    </div>


                    {/* NOTIFICATION */}

                    <div className="monitor-card">

                        <div className="monitor-title">

                            <span>
                                Notifications
                            </span>

                            <span className="monitor-icon">
                                🔔
                            </span>

                        </div>

                        <div className="monitor-value">
                            {notifications.sent}
                        </div>

                        <div className="monitor-label">
                            Notifications Sent
                        </div>

                        <div className="mini-stats">

                            <div>
                                <span>
                                    Failed
                                </span>

                                <strong className="danger-text">
                                    {notifications.failed}
                                </strong>
                            </div>

                        </div>

                    </div>


                    {/* SAGA */}

                    <div className="monitor-card">

                        <div className="monitor-title">

                            <span>
                                SAGA Workflow
                            </span>

                            <span className="monitor-icon">
                                🔄
                            </span>

                        </div>

                        <div className="monitor-value">
                            {saga.completed}
                        </div>

                        <div className="monitor-label">
                            Completed Workflows
                        </div>

                        <div className="mini-stats">

                            <div>
                                <span>
                                    Processing
                                </span>

                                <strong>
                                    {saga.processing}
                                </strong>
                            </div>

                            <div>
                                <span>
                                    Compensated
                                </span>

                                <strong className="warning-text">
                                    {saga.compensated}
                                </strong>
                            </div>

                            <div>
                                <span>
                                    Failed
                                </span>

                                <strong className="danger-text">
                                    {saga.failed}
                                </strong>
                            </div>

                        </div>

                    </div>

                </section>


                {/* =================================================
                    MAIN GRID
                ================================================= */}

                <section className="main-grid">


                    {/* TRANSACTION ANALYSIS */}

                    <div className="panel">

                        <div className="panel-header">

                            <div>

                                <h2>
                                    Latest Transaction
                                </h2>

                                <p>
                                    Most recent transaction analyzed
                                </p>

                            </div>

                            <span className="live">
                                ● LIVE
                            </span>

                        </div>


                        {recentTransactions.length > 0 ? (

                            (() => {

                                const transaction =
                                    recentTransactions[0];

                                const riskScore =
                                    transaction.risk_score !== null &&
                                    transaction.risk_score !== undefined
                                        ? Number(
                                            transaction.risk_score
                                        )
                                        : null;

                                const riskLevel =
                                    transaction.risk_level ||
                                    "NOT ANALYZED";

                                const decision =
                                    transaction.decision ||
                                    "PENDING ANALYSIS";

                                const riskClass =
                                    riskLevel === "HIGH"
                                        ? "high"
                                        : riskLevel === "MEDIUM"
                                            ? "medium"
                                            : riskLevel === "LOW"
                                                ? "low"
                                                : "neutral";

                                return (
                                    <>

                                        <div className="transaction-id">

                                            Transaction ID:

                                            <strong>
                                                {transaction.id}
                                            </strong>

                                        </div>


                                        <div className="transaction-details">

                                            <div>
                                                <span>
                                                    Amount
                                                </span>

                                                <strong>
                                                    ₹
                                                    {Number(
                                                        transaction.amount
                                                    ).toLocaleString(
                                                        "en-IN"
                                                    )}
                                                </strong>
                                            </div>

                                            <div>
                                                <span>
                                                    Merchant
                                                </span>

                                                <strong>
                                                    {transaction.merchant ||
                                                        "Unknown"}
                                                </strong>
                                            </div>

                                            <div>
                                                <span>
                                                    Location
                                                </span>

                                                <strong>
                                                    {transaction.location ||
                                                        "Unknown"}
                                                </strong>
                                            </div>

                                        </div>


                                        <div className="risk-section">

                                            <div
                                                className={`risk-circle ${riskClass}`}
                                            >

                                                <strong>
                                                    {riskScore !== null
                                                        ? riskScore
                                                        : "--"}
                                                </strong>

                                                <span>
                                                    /100
                                                </span>

                                                <small>
                                                    Risk Score
                                                </small>

                                            </div>


                                            <div className="risk-info">

                                                <div className="metric">

                                                    <span>
                                                        Risk Level
                                                    </span>

                                                    <strong>
                                                        <span
                                                            className={`badge ${riskClass}`}
                                                        >
                                                            {riskLevel}
                                                        </span>
                                                    </strong>

                                                </div>


                                                <div className="metric">

                                                    <span>
                                                        Decision
                                                    </span>

                                                    <strong>
                                                        {decision}
                                                    </strong>

                                                </div>


                                                <div className="metric">

                                                    <span>
                                                        Next Action
                                                    </span>

                                                    <strong>
                                                        {transaction.next_action ||
                                                            "WAITING"}
                                                    </strong>

                                                </div>

                                            </div>

                                        </div>


                                        <div className="signals">

                                            <h3>
                                                Transaction Information
                                            </h3>

                                            <div className="signal">

                                                👤 User:
                                                {" "}
                                                {transaction.user_id}

                                            </div>

                                            <div className="signal">

                                                🏪 Merchant:
                                                {" "}
                                                {transaction.merchant ||
                                                    "Unknown"}

                                            </div>

                                            <div className="signal graph">

                                                📍 Location:
                                                {" "}
                                                {transaction.location ||
                                                    "Unknown"}

                                            </div>

                                        </div>


                                        <div
                                            className={`decision-box ${riskClass}`}
                                        >

                                            <span>
                                                FINAL DECISION
                                            </span>

                                            <strong>
                                                {decision}
                                            </strong>

                                            <small>
                                                {transaction.next_action ||
                                                    "Awaiting analysis"}
                                            </small>

                                        </div>

                                    </>
                                );

                            })()

                        ) : (

                            <div className="empty-state">
                                No transactions available.
                            </div>

                        )}

                    </div>


                    {/* DETECTION PIPELINE */}

                    <div className="panel">

                        <div className="panel-header">

                            <div>

                                <h2>
                                    Detection Pipeline
                                </h2>

                                <p>
                                    Multi-layer fraud analysis
                                </p>

                            </div>

                        </div>


                        <div className="pipeline">

                            <div className="pipeline-item">

                                <span>
                                    01
                                </span>

                                <div>

                                    <strong>
                                        Kafka
                                    </strong>

                                    <small>
                                        Real-time transaction streaming
                                    </small>

                                </div>

                            </div>


                            <div className="arrow">
                                ↓
                            </div>


                            <div className="pipeline-item">

                                <span>
                                    02
                                </span>

                                <div>

                                    <strong>
                                        Redis
                                    </strong>

                                    <small>
                                        Velocity & behavioral analysis
                                    </small>

                                </div>

                            </div>


                            <div className="arrow">
                                ↓
                            </div>


                            <div className="pipeline-item">

                                <span>
                                    03
                                </span>

                                <div>

                                    <strong>
                                        Rules + ML
                                    </strong>

                                    <small>
                                        Explainable + predictive detection
                                    </small>

                                </div>

                            </div>


                            <div className="arrow">
                                ↓
                            </div>


                            <div className="pipeline-item">

                                <span>
                                    04
                                </span>

                                <div>

                                    <strong>
                                        Graph Analysis
                                    </strong>

                                    <small>
                                        Fraud relationship detection
                                    </small>

                                </div>

                            </div>


                            <div className="arrow">
                                ↓
                            </div>


                            <div className="pipeline-item final">

                                <span>
                                    05
                                </span>

                                <div>

                                    <strong>
                                        Risk Decision
                                    </strong>

                                    <small>
                                        APPROVED / HOLD / BLOCKED
                                    </small>

                                </div>

                            </div>

                        </div>

                    </div>

                </section>


                {/* =================================================
                    RECENT TRANSACTIONS
                ================================================= */}

                <section className="panel transactions">

                    <div className="panel-header">

                        <div>

                            <h2>
                                Recent Transactions
                            </h2>

                            <p>
                                Latest transactions from PostgreSQL
                            </p>

                        </div>

                        <span className="live">
                            ● AUTO REFRESH 5s
                        </span>

                    </div>


                    <div className="table-container">

                        <table>

                            <thead>

                                <tr>

                                    <th>
                                        Transaction ID
                                    </th>

                                    <th>
                                        Amount
                                    </th>

                                    <th>
                                        Location
                                    </th>

                                    <th>
                                        Risk Score
                                    </th>

                                    <th>
                                        Risk Level
                                    </th>

                                    <th>
                                        Decision
                                    </th>

                                </tr>

                            </thead>


                            <tbody>

                                {recentTransactions.map(
                                    (transaction) => {

                                        const riskLevel =
                                            transaction.risk_level ||
                                            "N/A";

                                        const riskClass =
                                            riskLevel === "HIGH"
                                                ? "high"
                                                : riskLevel === "MEDIUM"
                                                    ? "medium"
                                                    : riskLevel === "LOW"
                                                        ? "low"
                                                        : "neutral";

                                        const decision =
                                            transaction.decision ||
                                            "PENDING";

                                        return (

                                            <tr
                                                key={
                                                    transaction.id
                                                }
                                            >

                                                <td>
                                                    <strong>
                                                        {transaction.id}
                                                    </strong>
                                                </td>

                                                <td>
                                                    ₹
                                                    {Number(
                                                        transaction.amount
                                                    ).toLocaleString(
                                                        "en-IN"
                                                    )}
                                                </td>

                                                <td>
                                                    {transaction.location ||
                                                        "Unknown"}
                                                </td>

                                                <td>

                                                    {transaction.risk_score !==
                                                    null &&
                                                    transaction.risk_score !==
                                                    undefined
                                                        ? Number(
                                                            transaction.risk_score
                                                        )
                                                        : "--"}

                                                </td>

                                                <td>

                                                    <span
                                                        className={`badge ${riskClass}`}
                                                    >
                                                        {riskLevel}
                                                    </span>

                                                </td>

                                                <td
                                                    className={
                                                        decision ===
                                                        "BLOCKED"
                                                            ? "blocked"
                                                            : decision ===
                                                                "APPROVED"
                                                                ? "approved"
                                                                : "pending"
                                                    }
                                                >

                                                    {decision}

                                                </td>

                                            </tr>

                                        );

                                    }
                                )}

                            </tbody>

                        </table>

                    </div>

                </section>


                {/* =================================================
                    SYSTEM STATUS
                ================================================= */}

                <section className="system-grid">

                    <div className="system-card">

                        <span className="system-dot online"></span>

                        <div>

                            <strong>
                                PostgreSQL
                            </strong>

                            <small>
                                Persistent storage
                            </small>

                        </div>

                        <b>
                            ONLINE
                        </b>

                    </div>


                    <div className="system-card">

                        <span className="system-dot online"></span>

                        <div>

                            <strong>
                                Transaction Service
                            </strong>

                            <small>
                                Port 3003
                            </small>

                        </div>

                        <b>
                            ONLINE
                        </b>

                    </div>


                    <div className="system-card">

                        <span className="system-dot online"></span>

                        <div>

                            <strong>
                                Kafka
                            </strong>

                            <small>
                                Event streaming
                            </small>

                        </div>

                        <b>
                            ONLINE
                        </b>

                    </div>

                </section>

            </main>


            <footer>
                ScamShield AI • AI-Powered Real-Time Fraud Risk Engine
            </footer>

        </div>
    );
}

export default App;