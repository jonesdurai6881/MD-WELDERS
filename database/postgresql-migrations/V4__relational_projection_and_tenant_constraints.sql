-- V4: Scope unique constraints to tenant and add soft-delete columns for safe sync projection

-- 1. Replace global unique constraints with tenant-scoped unique constraints
ALTER TABLE customer_bills DROP CONSTRAINT IF EXISTS customer_bills_bill_number_key;
ALTER TABLE customer_bills ADD CONSTRAINT uq_bills_tenant_number UNIQUE (business_id, bill_number);

ALTER TABLE salary_transactions DROP CONSTRAINT IF EXISTS salary_transactions_idempotency_key_key;
ALTER TABLE salary_transactions ADD CONSTRAINT uq_salary_tenant_idempotency UNIQUE (business_id, idempotency_key);

ALTER TABLE stock_transactions DROP CONSTRAINT IF EXISTS stock_transactions_idempotency_key_key;
ALTER TABLE stock_transactions ADD CONSTRAINT uq_stock_tenant_idempotency UNIQUE (business_id, idempotency_key);

ALTER TABLE customer_payments DROP CONSTRAINT IF EXISTS customer_payments_idempotency_key_key;
ALTER TABLE customer_payments ADD CONSTRAINT uq_payments_tenant_idempotency UNIQUE (business_id, idempotency_key);

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_idempotency_key_key;
ALTER TABLE expenses ADD CONSTRAINT uq_expenses_tenant_idempotency UNIQUE (business_id, idempotency_key);

-- 2. Scope active worker day constraint to tenant
ALTER TABLE work_assignments DROP CONSTRAINT IF EXISTS uq_active_employee_work_day;
ALTER TABLE work_assignments ADD CONSTRAINT uq_active_emp_tenant_work_day
    UNIQUE (business_id, employee_id, work_date, active_assignment_flag);

-- 3. Add soft-delete flag to customers and materials
ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_active SMALLINT DEFAULT 1 NOT NULL CHECK (is_active IN (0, 1));
ALTER TABLE materials ADD COLUMN IF NOT EXISTS is_active SMALLINT DEFAULT 1 NOT NULL CHECK (is_active IN (0, 1));
