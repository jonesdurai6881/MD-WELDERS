CREATE TABLE app_users (
    user_id VARCHAR2(36 CHAR) PRIMARY KEY,
    username VARCHAR2(120 CHAR) NOT NULL UNIQUE,
    password_hash VARCHAR2(255 CHAR) NOT NULL,
    role_code VARCHAR2(30 CHAR) DEFAULT 'ADMIN' NOT NULL,
    is_active NUMBER(1) DEFAULT 1 NOT NULL CHECK (is_active IN (0, 1)),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE employees (
    employee_id VARCHAR2(36 CHAR) PRIMARY KEY,
    full_name VARCHAR2(160 CHAR) NOT NULL,
    phone VARCHAR2(40 CHAR),
    address VARCHAR2(500 CHAR),
    location VARCHAR2(200 CHAR),
    joining_date DATE,
    daily_salary NUMBER(14,2) DEFAULT 0 NOT NULL CHECK (daily_salary >= 0),
    photo_uri VARCHAR2(1000 CHAR),
    is_active NUMBER(1) DEFAULT 1 NOT NULL CHECK (is_active IN (0, 1)),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE customers (
    customer_id VARCHAR2(36 CHAR) PRIMARY KEY,
    full_name VARCHAR2(160 CHAR) NOT NULL,
    phone VARCHAR2(40 CHAR),
    email VARCHAR2(254 CHAR),
    address VARCHAR2(500 CHAR),
    location VARCHAR2(200 CHAR),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE work_orders (
    work_order_id VARCHAR2(36 CHAR) PRIMARY KEY,
    customer_id VARCHAR2(36 CHAR) REFERENCES customers(customer_id),
    title VARCHAR2(200 CHAR) NOT NULL,
    job_location VARCHAR2(300 CHAR),
    work_date DATE NOT NULL,
    status_code VARCHAR2(24 CHAR) DEFAULT 'PENDING' NOT NULL
        CHECK (status_code IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    notes VARCHAR2(2000 CHAR),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE work_assignments (
    assignment_id VARCHAR2(36 CHAR) PRIMARY KEY,
    work_order_id VARCHAR2(36 CHAR) NOT NULL REFERENCES work_orders(work_order_id),
    employee_id VARCHAR2(36 CHAR) NOT NULL REFERENCES employees(employee_id),
    work_date DATE NOT NULL,
    daily_rate NUMBER(14,2) NOT NULL CHECK (daily_rate >= 0),
    assignment_status VARCHAR2(16 CHAR) DEFAULT 'ACTIVE' NOT NULL
        CHECK (assignment_status IN ('ACTIVE', 'CANCELLED')),
    active_assignment_flag NUMBER
        GENERATED ALWAYS AS (CASE WHEN assignment_status = 'ACTIVE' THEN 1 END) VIRTUAL,
    CONSTRAINT uq_active_employee_work_day UNIQUE (employee_id, work_date, active_assignment_flag)
);

CREATE TABLE salary_transactions (
    salary_transaction_id VARCHAR2(36 CHAR) PRIMARY KEY,
    employee_id VARCHAR2(36 CHAR) NOT NULL REFERENCES employees(employee_id),
    amount NUMBER(14,2) NOT NULL CHECK (amount > 0),
    paid_at TIMESTAMP WITH TIME ZONE NOT NULL,
    idempotency_key VARCHAR2(80 CHAR) NOT NULL UNIQUE,
    note VARCHAR2(500 CHAR)
);

CREATE TABLE materials (
    material_id VARCHAR2(36 CHAR) PRIMARY KEY,
    name VARCHAR2(160 CHAR) NOT NULL,
    unit VARCHAR2(30 CHAR) NOT NULL,
    low_stock_threshold NUMBER(14,3) DEFAULT 0 NOT NULL CHECK (low_stock_threshold >= 0),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE stock_transactions (
    stock_transaction_id VARCHAR2(36 CHAR) PRIMARY KEY,
    material_id VARCHAR2(36 CHAR) NOT NULL REFERENCES materials(material_id),
    transaction_type VARCHAR2(12 CHAR) NOT NULL CHECK (transaction_type IN ('PURCHASE', 'USAGE')),
    quantity NUMBER(14,3) NOT NULL CHECK (quantity > 0),
    unit_cost NUMBER(14,2) DEFAULT 0 NOT NULL CHECK (unit_cost >= 0),
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    idempotency_key VARCHAR2(80 CHAR) NOT NULL UNIQUE,
    work_order_id VARCHAR2(36 CHAR) REFERENCES work_orders(work_order_id),
    note VARCHAR2(500 CHAR)
);

CREATE TABLE customer_bills (
    bill_id VARCHAR2(36 CHAR) PRIMARY KEY,
    customer_id VARCHAR2(36 CHAR) NOT NULL REFERENCES customers(customer_id),
    work_order_id VARCHAR2(36 CHAR) REFERENCES work_orders(work_order_id),
    bill_number VARCHAR2(60 CHAR) NOT NULL UNIQUE,
    total_amount NUMBER(14,2) NOT NULL CHECK (total_amount >= 0),
    issued_at TIMESTAMP WITH TIME ZONE NOT NULL,
    description VARCHAR2(1000 CHAR)
);

CREATE TABLE customer_payments (
    payment_id VARCHAR2(36 CHAR) PRIMARY KEY,
    customer_id VARCHAR2(36 CHAR) NOT NULL REFERENCES customers(customer_id),
    bill_id VARCHAR2(36 CHAR) REFERENCES customer_bills(bill_id),
    amount NUMBER(14,2) NOT NULL CHECK (amount > 0),
    received_at TIMESTAMP WITH TIME ZONE NOT NULL,
    idempotency_key VARCHAR2(80 CHAR) NOT NULL UNIQUE,
    method VARCHAR2(40 CHAR),
    note VARCHAR2(500 CHAR)
);

CREATE TABLE expenses (
    expense_id VARCHAR2(36 CHAR) PRIMARY KEY,
    category VARCHAR2(80 CHAR) NOT NULL,
    description VARCHAR2(300 CHAR) NOT NULL,
    amount NUMBER(14,2) NOT NULL CHECK (amount > 0),
    incurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    idempotency_key VARCHAR2(80 CHAR) NOT NULL UNIQUE
);

CREATE TABLE ai_proposed_transactions (
    proposal_id VARCHAR2(36 CHAR) PRIMARY KEY,
    user_id VARCHAR2(36 CHAR) REFERENCES app_users(user_id),
    transaction_type VARCHAR2(40 CHAR) NOT NULL,
    draft_payload CLOB NOT NULL CHECK (draft_payload IS JSON),
    status_code VARCHAR2(16 CHAR) DEFAULT 'PENDING' NOT NULL
        CHECK (status_code IN ('PENDING', 'CONFIRMED', 'REJECTED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    confirmed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE sync_records (
    entity_type VARCHAR2(40 CHAR) NOT NULL,
    record_id VARCHAR2(36 CHAR) NOT NULL,
    payload CLOB NOT NULL CHECK (payload IS JSON),
    version_number NUMBER(12) NOT NULL CHECK (version_number > 0),
    is_deleted NUMBER(1) DEFAULT 0 NOT NULL CHECK (is_deleted IN (0, 1)),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    PRIMARY KEY (entity_type, record_id)
);

CREATE TABLE sync_queue (
    idempotency_key VARCHAR2(80 CHAR) PRIMARY KEY,
    entity_type VARCHAR2(40 CHAR) NOT NULL,
    record_id VARCHAR2(36 CHAR) NOT NULL,
    operation_code VARCHAR2(12 CHAR) NOT NULL CHECK (operation_code IN ('UPSERT', 'DELETE')),
    status_code VARCHAR2(16 CHAR) DEFAULT 'APPLIED' NOT NULL,
    server_version NUMBER(12) NOT NULL CHECK (server_version > 0),
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);

CREATE TABLE audit_logs (
    audit_id VARCHAR2(36 CHAR) PRIMARY KEY,
    user_id VARCHAR2(36 CHAR) REFERENCES app_users(user_id),
    action_code VARCHAR2(80 CHAR) NOT NULL,
    entity_type VARCHAR2(40 CHAR) NOT NULL,
    record_id VARCHAR2(36 CHAR) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL,
    details CLOB CHECK (details IS JSON)
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
