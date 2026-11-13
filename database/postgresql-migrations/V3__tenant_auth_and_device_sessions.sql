CREATE TABLE businesses (
    business_id VARCHAR(36) PRIMARY KEY,
    business_name VARCHAR(160) NOT NULL,
    is_active SMALLINT DEFAULT 1 NOT NULL CHECK (is_active IN (0, 1)),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT INTO businesses (business_id, business_name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Legacy Business');

ALTER TABLE app_users ADD COLUMN business_id VARCHAR(36);
ALTER TABLE employees ADD COLUMN business_id VARCHAR(36);
ALTER TABLE customers ADD COLUMN business_id VARCHAR(36);
ALTER TABLE work_orders ADD COLUMN business_id VARCHAR(36);
ALTER TABLE work_assignments ADD COLUMN business_id VARCHAR(36);
ALTER TABLE salary_transactions ADD COLUMN business_id VARCHAR(36);
ALTER TABLE materials ADD COLUMN business_id VARCHAR(36);
ALTER TABLE stock_transactions ADD COLUMN business_id VARCHAR(36);
ALTER TABLE customer_bills ADD COLUMN business_id VARCHAR(36);
ALTER TABLE customer_payments ADD COLUMN business_id VARCHAR(36);
ALTER TABLE expenses ADD COLUMN business_id VARCHAR(36);
ALTER TABLE ai_proposed_transactions ADD COLUMN business_id VARCHAR(36);
ALTER TABLE sync_records ADD COLUMN business_id VARCHAR(36);
ALTER TABLE sync_queue ADD COLUMN business_id VARCHAR(36);
ALTER TABLE audit_logs ADD COLUMN business_id VARCHAR(36);

UPDATE app_users SET business_id = '00000000-0000-4000-8000-000000000001';
UPDATE employees SET business_id = '00000000-0000-4000-8000-000000000001';
UPDATE customers SET business_id = '00000000-0000-4000-8000-000000000001';
UPDATE work_orders SET business_id = '00000000-0000-4000-8000-000000000001';
UPDATE work_assignments SET business_id = '00000000-0000-4000-8000-000000000001';
UPDATE salary_transactions SET business_id = '00000000-0000-4000-8000-000000000001';
UPDATE materials SET business_id = '00000000-0000-4000-8000-000000000001';
UPDATE stock_transactions SET business_id = '00000000-0000-4000-8000-000000000001';
UPDATE customer_bills SET business_id = '00000000-0000-4000-8000-000000000001';
UPDATE customer_payments SET business_id = '00000000-0000-4000-8000-000000000001';
UPDATE expenses SET business_id = '00000000-0000-4000-8000-000000000001';
UPDATE ai_proposed_transactions SET business_id = '00000000-0000-4000-8000-000000000001';
UPDATE sync_records SET business_id = '00000000-0000-4000-8000-000000000001';
UPDATE sync_queue SET business_id = '00000000-0000-4000-8000-000000000001';
UPDATE audit_logs SET business_id = '00000000-0000-4000-8000-000000000001';

ALTER TABLE app_users ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE employees ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE customers ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE work_orders ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE work_assignments ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE salary_transactions ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE materials ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE stock_transactions ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE customer_bills ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE customer_payments ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE expenses ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE ai_proposed_transactions ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE sync_records ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE sync_queue ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE audit_logs ALTER COLUMN business_id SET NOT NULL;

ALTER TABLE app_users ADD CONSTRAINT fk_users_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);
ALTER TABLE employees ADD CONSTRAINT fk_employees_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);
ALTER TABLE customers ADD CONSTRAINT fk_customers_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);
ALTER TABLE work_orders ADD CONSTRAINT fk_work_orders_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);
ALTER TABLE work_assignments ADD CONSTRAINT fk_assignments_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);
ALTER TABLE salary_transactions ADD CONSTRAINT fk_salary_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);
ALTER TABLE materials ADD CONSTRAINT fk_materials_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);
ALTER TABLE stock_transactions ADD CONSTRAINT fk_stock_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);
ALTER TABLE customer_bills ADD CONSTRAINT fk_bills_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);
ALTER TABLE customer_payments ADD CONSTRAINT fk_payments_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);
ALTER TABLE expenses ADD CONSTRAINT fk_expenses_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);
ALTER TABLE ai_proposed_transactions ADD CONSTRAINT fk_proposals_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);
ALTER TABLE sync_records ADD CONSTRAINT fk_sync_records_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);
ALTER TABLE sync_queue ADD CONSTRAINT fk_sync_queue_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);
ALTER TABLE audit_logs ADD CONSTRAINT fk_audit_business FOREIGN KEY (business_id) REFERENCES businesses(business_id);

ALTER TABLE sync_records DROP CONSTRAINT pk_sync_records;
ALTER TABLE sync_records ADD CONSTRAINT pk_sync_records_tenant PRIMARY KEY (business_id, entity_type, record_id);
ALTER TABLE sync_queue DROP CONSTRAINT pk_sync_queue;
ALTER TABLE sync_queue ADD CONSTRAINT pk_sync_queue_tenant PRIMARY KEY (business_id, idempotency_key);

CREATE INDEX idx_users_business ON app_users(business_id);
CREATE INDEX idx_sync_records_tenant_updated ON sync_records(business_id, updated_at, entity_type, record_id);
CREATE INDEX idx_sync_queue_tenant ON sync_queue(business_id, idempotency_key);
CREATE INDEX idx_audit_tenant_date ON audit_logs(business_id, occurred_at);

CREATE TABLE device_sessions (
    session_id VARCHAR(36) PRIMARY KEY,
    business_id VARCHAR(36) NOT NULL REFERENCES businesses(business_id),
    user_id VARCHAR(36) NOT NULL REFERENCES app_users(user_id),
    device_id VARCHAR(160) NOT NULL,
    device_name VARCHAR(160) NOT NULL,
    platform VARCHAR(40) NOT NULL,
    access_token_hash VARCHAR(64) NOT NULL,
    access_expires_at TIMESTAMPTZ NOT NULL,
    refresh_token_hash VARCHAR(64) NOT NULL,
    refresh_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT uq_device_session_user_device UNIQUE (user_id, device_id)
);

CREATE INDEX idx_device_sessions_business ON device_sessions(business_id, user_id);
CREATE INDEX idx_device_sessions_access ON device_sessions(access_token_hash, access_expires_at);
CREATE INDEX idx_device_sessions_refresh ON device_sessions(refresh_token_hash, refresh_expires_at);
