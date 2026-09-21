-- =========================================
-- SCAMSHIELD DATABASE SCHEMA
-- PHASE 6 - DATABASE & PERSISTENCE
-- =========================================


-- =========================================
-- USERS
-- =========================================

CREATE TABLE users (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    registered_device VARCHAR(100),
    registered_location VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- =========================================
-- ACCOUNTS
-- =========================================

CREATE TABLE accounts (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) REFERENCES users(id),
    balance NUMERIC(15,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- =========================================
-- TRANSACTIONS
-- =========================================

CREATE TABLE transactions (
    id VARCHAR(50) PRIMARY KEY,
    user_id VARCHAR(50) REFERENCES users(id),
    account_id VARCHAR(50) REFERENCES accounts(id),
    amount NUMERIC(15,2) NOT NULL,
    merchant VARCHAR(200),
    device_id VARCHAR(100),
    location VARCHAR(100),

    status VARCHAR(30) DEFAULT 'ANALYZING',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- =========================================
-- RISK DECISIONS
-- =========================================

CREATE TABLE risk_decisions (
    id SERIAL PRIMARY KEY,

    transaction_id VARCHAR(50)
        REFERENCES transactions(id),

    risk_score NUMERIC(5,2),

    risk_level VARCHAR(30),

    decision VARCHAR(30),

    next_action VARCHAR(50),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- =========================================
-- PAYMENTS
-- =========================================

CREATE TABLE payments (
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


-- =========================================
-- NOTIFICATIONS
-- =========================================

CREATE TABLE notifications (
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


-- =========================================
-- SAGA EXECUTIONS
-- =========================================

CREATE TABLE saga_executions (
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

CREATE INDEX idx_transactions_user
ON transactions(user_id);


CREATE INDEX idx_transactions_status
ON transactions(status);


CREATE INDEX idx_risk_decisions_transaction
ON risk_decisions(transaction_id);


CREATE INDEX idx_payments_transaction
ON payments(transaction_id);


CREATE INDEX idx_notifications_transaction
ON notifications(transaction_id);


CREATE INDEX idx_saga_transaction
ON saga_executions(transaction_id);