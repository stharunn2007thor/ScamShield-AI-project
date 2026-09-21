INSERT INTO users (id, name, registered_device, registered_location)
VALUES
('USR001', 'Test User', 'DEVICE001', 'Chennai');

INSERT INTO accounts (id, user_id, balance, status)
VALUES
('ACC001', 'USR001', 50000.00, 'ACTIVE');

INSERT INTO transactions
(id, user_id, account_id, amount, merchant, device_id, location, status)
VALUES
('TXN001', 'USR001', 'ACC001', 1500.00, 'Amazon', 'DEVICE001', 'Chennai', 'COMPLETED'),

('TXN002', 'USR001', 'ACC001', 25000.00, 'Unknown Merchant', 'DEVICE999', 'Mumbai', 'ANALYZING');