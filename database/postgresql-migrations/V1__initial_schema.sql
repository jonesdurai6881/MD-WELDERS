CREATE TABLE app_users (
    user_id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_code VARCHAR(30) DEFAULT 'ADMIN' NOT NULL,
    is_active SMALLINT DEFAULT 1 NOT NULL CHECK (is_active IN (0, 1)),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE employees (
    employee_id VARCHAR(36) PRIMARY KEY,
    full_name VARCHAR(160) NOT NULL,
    phone VARCHAR(40),
    address VARCHAR(500),
    location VARCHAR(200),
    joining_date DATE,
    daily_salary NUMERIC(14,2) DEFAULT 0 NOT NULL CHECK (daily_salary >= 0),
    photo_uri VARCHAR(1000),
    is_active SMALLINT DEFAULT 1 NOT NULL CHECK (is_active IN (0, 1)),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE customers (
    customer_id VARCHAR(36) PRIMARY KEY,
    full_name VARCHAR(160) NOT NULL,
    phone VARCHAR(40),
    email VARCHAR(254),
    address VARCHAR(500),
    location VARCHAR(200),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE work_orders (
    work_order_id VARCHAR(36) PRIMARY KEY,
    customer_id VARCHAR(36) REFERENCES customers(customer_id),
    title VARCHAR(200) NOT NULL,
    job_location VARCHAR(300),
    work_date DATE NOT NULL,
    status_code VARCHAR(24) DEFAULT 'PENDING' NOT NULL
        CHECK (status_code IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    notes VARCHAR(2000),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE work_assignments (
    assignment_id VARCHAR(36) PRIMARY KEY,
    work_order_id VARCHAR(36) NOT NULL REFERENCES work_orders(work_order_id),
    employee_id VARCHAR(36) NOT NULL REFERENCES employees(employee_id),
    work_date DATE NOT NULL,
    daily_rate NUMERIC(14,2) NOT NULL CHECK (daily_rate >= 0),
    assignment_status VARCHAR(16) DEFAULT 'ACTIVE' NOT NULL
        CHECK (assignment_status IN ('ACTIVE', 'CANCELLED')),
    active_assignment_flag SMALLINT GENERATED ALWAYS AS
        (CASE WHEN assignment_status = 'ACTIVE' THEN 1 ELSE NULL END) STORED,
    CONSTRAINT uq_active_employee_work_day UNIQUE (employee_id, work_date, active_assignment_flag)
);

CREATE TABLE salary_transactions (
    salary_transaction_id VARCHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL REFERENCES employees(employee_id),
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    paid_at TIMESTAMPTZ NOT NULL,
    idempotency_key VARCHAR(80) NOT NULL UNIQUE,
    note VARCHAR(500)
);

CREATE TABLE materials (
    material_id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    unit VARCHAR(30) NOT NULL,
    low_stock_threshold NUMERIC(14,3) DEFAULT 0 NOT NULL CHECK (low_stock_threshold >= 0),
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE stock_transactions (
    stock_transaction_id VARCHAR(36) PRIMARY KEY,
    material_id VARCHAR(36) NOT NULL REFERENCES materials(material_id),
    transaction_type VARCHAR(12) NOT NULL CHECK (transaction_type IN ('PURCHASE', 'USAGE')),
    quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(14,2) DEFAULT 0 NOT NULL CHECK (unit_cost >= 0),
    occurred_at TIMESTAMPTZ NOT NULL,
    idempotency_key VARCHAR(80) NOT NULL UNIQUE,
    work_order_id VARCHAR(36) REFERENCES work_orders(work_order_id),
    note VARCHAR(500)
);

CREATE TABLE customer_bills (
    bill_id VARCHAR(36) PRIMARY KEY,
    customer_id VARCHAR(36) NOT NULL REFERENCES customers(customer_id),
    work_order_id VARCHAR(36) REFERENCES work_orders(work_order_id),
    bill_number VARCHAR(60) NOT NULL UNIQUE,
    total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
    issued_at TIMESTAMPTZ NOT NULL,
    description VARCHAR(1000)
);

CREATE TABLE customer_payments (
    payment_id VARCHAR(36) PRIMARY KEY,
    customer_id VARCHAR(36) NOT NULL REFERENCES customers(customer_id),
    bill_id VARCHAR(36) REFERENCES customer_bills(bill_id),
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    received_at TIMESTAMPTZ NOT NULL,
    idempotency_key VARCHAR(80) NOT NULL UNIQUE,
    method VARCHAR(40),
    note VARCHAR(500)
);

CREATE TABLE expenses (
    expense_id VARCHAR(36) PRIMARY KEY,
    category VARCHAR(80) NOT NULL,
    description VARCHAR(300) NOT NULL,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    incurred_at TIMESTAMPTZ NOT NULL,
    idempotency_key VARCHAR(80) NOT NULL UNIQUE
);

CREATE TABLE ai_proposed_transactions (
    proposal_id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) REFERENCES app_users(user_id),
    transaction_type VARCHAR(40) NOT NULL,
    draft_payload JSONB NOT NULL,
    status_code VARCHAR(16) DEFAULT 'PENDING' NOT NULL
        CHECK (status_code IN ('PENDING', 'CONFIRMED', 'REJECTED')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    confirmed_at TIMESTAMPTZ
);

CREATE TABLE sync_records (
    entity_type VARCHAR(40) NOT NULL,
    record_id VARCHAR(36) NOT NULL,
    payload JSONB NOT NULL,
    version_number NUMERIC(12) NOT NULL CHECK (version_number > 0),
    is_deleted SMALLINT DEFAULT 0 NOT NULL CHECK (is_deleted IN (0, 1)),
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_sync_records PRIMARY KEY (entity_type, record_id)
);

CREATE TABLE sync_queue (
    idempotency_key VARCHAR(80) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    record_id VARCHAR(36) NOT NULL,
    operation_code VARCHAR(12) NOT NULL CHECK (operation_code IN ('UPSERT', 'DELETE')),
    status_code VARCHAR(16) DEFAULT 'APPLIED' NOT NULL,
    server_version NUMERIC(12) NOT NULL CHECK (server_version > 0),
    applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT pk_sync_queue PRIMARY KEY (idempotency_key)
);

CREATE TABLE audit_logs (
    audit_id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) REFERENCES app_users(user_id),
    action_code VARCHAR(80) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    record_id VARCHAR(36) NOT NULL,
    occurred_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL,
    details JSONB
);

CREATE INDEX idx_work_orders_date ON work_orders(work_date);
CREATE INDEX idx_work_orders_customer ON work_orders(customer_id);
CREATE INDEX idx_salary_employee_date ON salary_transactions(employee_id, paid_at);
CREATE INDEX idx_stock_material_date ON stock_transactions(material_id, occurred_at);
CREATE INDEX idx_bills_customer_date ON customer_bills(customer_id, issued_at);
CREATE INDEX idx_payments_customer_date ON customer_payments(customer_id, received_at);
CREATE INDEX idx_expenses_date ON expenses(incurred_at);
CREATE INDEX idx_audit_entity_date ON audit_logs(entity_type, record_id, occurred_at);
CREATE INDEX idx_sync_updated ON sync_records(updated_at);
