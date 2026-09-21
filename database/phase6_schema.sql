-- =========================================
-- SCAMSHIELD
-- PHASE 6 - DATABASE PERSISTENCE TABLES
-- =========================================

CREATE TABLE IF NOT EXISTS risk_decisions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(50)
        REFERENCES transactions(id),
    risk_score NUMERIC(5,2),
    risk_level VARCHAR(30),
    decision VARCHAR(30),
    next_action VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(50)
        REFERENCES transactions(id),
    amount NUMERIC(15,2) NOT NULL,
    status VARCHAR(40) NOT NULL,
    simulate_failure BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(50)
        REFERENCES transactions(id),
    notification_type VARCHAR(50),
    payment_status VARCHAR(40),
    message TEXT,
    status VARCHAR(40) NOT NULL,
    simulate_failure BOOLEAN DEFAULT FALSE,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS saga_executions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(50)
        REFERENCES transactions(id),
    amount NUMERIC(15,2) NOT NULL,
    saga_status VARCHAR(50) NOT NULL,
    payment_status VARCHAR(50),
    notification_status VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- =========================================
-- INDEXES
-- =========================================

CREATE INDEX IF NOT EXISTS idx_transactions_user
ON transactions(user_id);

CREATE INDEX IF NOT EXISTS idx_transactions_status
ON transactions(status);

CREATE INDEX IF NOT EXISTS idx_risk_decisions_transaction
ON risk_decisions(transaction_id);

CREATE INDEX IF NOT EXISTS idx_payments_transaction
ON payments(transaction_id);

CREATE INDEX IF NOT EXISTS idx_notifications_transaction
ON notifications(transaction_id);

CREATE INDEX IF NOT EXISTS idx_saga_transaction
ON saga_executions(transaction_id);