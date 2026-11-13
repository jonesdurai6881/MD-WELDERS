package com.mdwelders.api.sync.projection;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class PostgresRelationalProjector implements RelationalProjector {
    private final JdbcTemplate jdbc;

    public PostgresRelationalProjector(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void project(String businessId, String entityType, String recordId, String operation, JsonNode payload) {
        boolean isDelete = "DELETE".equalsIgnoreCase(operation) || payload.path("deleted").asBoolean(false);
        switch (entityType) {
            case "employees" -> projectEmployee(businessId, recordId, isDelete, payload);
            case "customers" -> projectCustomer(businessId, recordId, isDelete, payload);
            case "materials" -> projectMaterial(businessId, recordId, isDelete, payload);
            case "workOrders" -> projectWorkOrder(businessId, recordId, isDelete, payload);
            case "assignments" -> projectAssignment(businessId, recordId, isDelete, payload);
            case "bills" -> projectBill(businessId, recordId, isDelete, payload);
            case "salaryPayments" -> projectSalaryPayment(businessId, recordId, isDelete, payload);
            case "stockTransactions" -> projectStockTransaction(businessId, recordId, isDelete, payload);
            case "customerPayments" -> projectCustomerPayment(businessId, recordId, isDelete, payload);
            case "expenses" -> projectExpense(businessId, recordId, isDelete, payload);
            case "aiProposals", "settings" -> {
                // Maintained in sync_records; no dedicated normalized business table
            }
            default -> throw new IllegalArgumentException("Unsupported entity type for relational projection: " + entityType);
        }
    }

    private void projectEmployee(String businessId, String recordId, boolean isDelete, JsonNode p) {
        String fullName = text(p, "fullName", "Unnamed Employee");
        String phone = optText(p, "phone");
        String address = optText(p, "address");
        String location = optText(p, "location");
        Date joiningDate = parseDate(optText(p, "joiningDate"));
        BigDecimal dailySalary = decimal(p, "dailySalary", BigDecimal.ZERO);
        String photoUri = optText(p, "photoUri");
        if (photoUri != null && photoUri.length() > 1000) {
            photoUri = photoUri.substring(0, 1000);
        }
        String role = optText(p, "role");
        if (role == null) role = optText(p, "jobRole");
        int isActive = (isDelete || !p.path("isActive").asBoolean(true)) ? 0 : 1;
        Timestamp updatedAt = parseTimestamp(optText(p, "updatedAt"));

        jdbc.update("""
                INSERT INTO employees (
                    employee_id, business_id, full_name, phone, address, location,
                    joining_date, daily_salary, photo_uri, is_active, updated_at, job_role)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (employee_id) DO UPDATE SET
                    business_id = EXCLUDED.business_id,
                    full_name = EXCLUDED.full_name,
                    phone = EXCLUDED.phone,
                    address = EXCLUDED.address,
                    location = EXCLUDED.location,
                    joining_date = EXCLUDED.joining_date,
                    daily_salary = EXCLUDED.daily_salary,
                    photo_uri = EXCLUDED.photo_uri,
                    is_active = EXCLUDED.is_active,
                    updated_at = EXCLUDED.updated_at,
                    job_role = EXCLUDED.job_role
                """,
                recordId, businessId, fullName, phone, address, location,
                joiningDate, dailySalary, photoUri, isActive, updatedAt, role);
    }

    private void projectCustomer(String businessId, String recordId, boolean isDelete, JsonNode p) {
        String fullName = text(p, "fullName", "Unnamed Customer");
        String phone = optText(p, "phone");
        String email = optText(p, "email");
        String address = optText(p, "address");
        String location = optText(p, "location");
        Timestamp updatedAt = parseTimestamp(optText(p, "updatedAt"));
        int isActive = isDelete ? 0 : 1;

        jdbc.update("""
                INSERT INTO customers (
                    customer_id, business_id, full_name, phone, email, address, location, updated_at, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (customer_id) DO UPDATE SET
                    business_id = EXCLUDED.business_id,
                    full_name = EXCLUDED.full_name,
                    phone = EXCLUDED.phone,
                    email = EXCLUDED.email,
                    address = EXCLUDED.address,
                    location = EXCLUDED.location,
                    updated_at = EXCLUDED.updated_at,
                    is_active = EXCLUDED.is_active
                """,
                recordId, businessId, fullName, phone, email, address, location, updatedAt, isActive);
    }

    private void projectMaterial(String businessId, String recordId, boolean isDelete, JsonNode p) {
        String name = text(p, "name", "Unnamed Material");
        String unit = text(p, "unit", "unit");
        BigDecimal lowStock = decimal(p, "lowStockThreshold", BigDecimal.ZERO);
        Timestamp updatedAt = parseTimestamp(optText(p, "updatedAt"));
        int isActive = isDelete ? 0 : 1;

        jdbc.update("""
                INSERT INTO materials (
                    material_id, business_id, name, unit, low_stock_threshold, updated_at, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (material_id) DO UPDATE SET
                    business_id = EXCLUDED.business_id,
                    name = EXCLUDED.name,
                    unit = EXCLUDED.unit,
                    low_stock_threshold = EXCLUDED.low_stock_threshold,
                    updated_at = EXCLUDED.updated_at,
                    is_active = EXCLUDED.is_active
                """,
                recordId, businessId, name, unit, lowStock, updatedAt, isActive);
    }

    private void projectWorkOrder(String businessId, String recordId, boolean isDelete, JsonNode p) {
        String customerId = optText(p, "customerId");
        String title = text(p, "title", "Work Order");
        String location = optText(p, "location");
        Date workDate = parseDate(optText(p, "workDate"));
        String status = isDelete ? "CANCELLED" : text(p, "status", "PENDING").toUpperCase();
        String notes = optText(p, "notes");
        Timestamp updatedAt = parseTimestamp(optText(p, "updatedAt"));

        jdbc.update("""
                INSERT INTO work_orders (
                    work_order_id, business_id, customer_id, title, job_location,
                    work_date, status_code, notes, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (work_order_id) DO UPDATE SET
                    business_id = EXCLUDED.business_id,
                    customer_id = EXCLUDED.customer_id,
                    title = EXCLUDED.title,
                    job_location = EXCLUDED.job_location,
                    work_date = EXCLUDED.work_date,
                    status_code = EXCLUDED.status_code,
                    notes = EXCLUDED.notes,
                    updated_at = EXCLUDED.updated_at
                """,
                recordId, businessId, customerId, title, location, workDate, status, notes, updatedAt);
    }

    private void projectAssignment(String businessId, String recordId, boolean isDelete, JsonNode p) {
        String workOrderId = text(p, "workOrderId", null);
        String employeeId = text(p, "employeeId", null);
        Date workDate = parseDate(optText(p, "workDate"));
        BigDecimal dailyRate = decimal(p, "dailyRate", BigDecimal.ZERO);
        String status = isDelete ? "CANCELLED" : text(p, "status", "ACTIVE").toUpperCase();

        jdbc.update("""
                INSERT INTO work_assignments (
                    assignment_id, business_id, work_order_id, employee_id,
                    work_date, daily_rate, assignment_status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (assignment_id) DO UPDATE SET
                    business_id = EXCLUDED.business_id,
                    work_order_id = EXCLUDED.work_order_id,
                    employee_id = EXCLUDED.employee_id,
                    work_date = EXCLUDED.work_date,
                    daily_rate = EXCLUDED.daily_rate,
                    assignment_status = EXCLUDED.assignment_status
                """,
                recordId, businessId, workOrderId, employeeId, workDate, dailyRate, status);
    }

    private void projectBill(String businessId, String recordId, boolean isDelete, JsonNode p) {
        if (isDelete) {
            throw new IllegalArgumentException("Financial bills cannot be deleted.");
        }
        String customerId = text(p, "customerId", null);
        String workOrderId = optText(p, "workOrderId");
        String billNumber = text(p, "billNumber", "BILL-" + recordId);
        BigDecimal amount = decimal(p, "amount", BigDecimal.ZERO);
        Timestamp issuedAt = parseTimestamp(optText(p, "issuedAt"));
        String description = optText(p, "description");

        jdbc.update("""
                INSERT INTO customer_bills (
                    bill_id, business_id, customer_id, work_order_id, bill_number,
                    total_amount, issued_at, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (bill_id) DO UPDATE SET
                    business_id = EXCLUDED.business_id,
                    customer_id = EXCLUDED.customer_id,
                    work_order_id = EXCLUDED.work_order_id,
                    bill_number = EXCLUDED.bill_number,
                    total_amount = EXCLUDED.total_amount,
                    issued_at = EXCLUDED.issued_at,
                    description = EXCLUDED.description
                """,
                recordId, businessId, customerId, workOrderId, billNumber, amount, issuedAt, description);
    }

    private void projectSalaryPayment(String businessId, String recordId, boolean isDelete, JsonNode p) {
        if (isDelete) {
            throw new IllegalArgumentException("Salary payment transactions cannot be deleted.");
        }
        String employeeId = text(p, "employeeId", null);
        BigDecimal amount = decimal(p, "amount", BigDecimal.ZERO);
        Timestamp paidAt = parseTimestamp(optText(p, "paidAt"));
        String idempotencyKey = text(p, "idempotencyKey", recordId);
        String note = optText(p, "note");

        jdbc.update("""
                INSERT INTO salary_transactions (
                    salary_transaction_id, business_id, employee_id, amount,
                    paid_at, idempotency_key, note)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (salary_transaction_id) DO UPDATE SET
                    business_id = EXCLUDED.business_id,
                    employee_id = EXCLUDED.employee_id,
                    amount = EXCLUDED.amount,
                    paid_at = EXCLUDED.paid_at,
                    idempotency_key = EXCLUDED.idempotency_key,
                    note = EXCLUDED.note
                """,
                recordId, businessId, employeeId, amount, paidAt, idempotencyKey, note);
    }

    private void projectStockTransaction(String businessId, String recordId, boolean isDelete, JsonNode p) {
        if (isDelete) {
            throw new IllegalArgumentException("Stock transactions cannot be deleted.");
        }
        String materialId = text(p, "materialId", null);
        String type = text(p, "type", "PURCHASE").toUpperCase();
        BigDecimal quantity = decimal(p, "quantity", BigDecimal.ZERO);
        BigDecimal unitCost = decimal(p, "unitCost", BigDecimal.ZERO);
        Timestamp occurredAt = parseTimestamp(optText(p, "occurredAt"));
        String idempotencyKey = text(p, "idempotencyKey", recordId);
        String workOrderId = optText(p, "workOrderId");
        String note = optText(p, "note");

        jdbc.update("""
                INSERT INTO stock_transactions (
                    stock_transaction_id, business_id, material_id, transaction_type,
                    quantity, unit_cost, occurred_at, idempotency_key, work_order_id, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (stock_transaction_id) DO UPDATE SET
                    business_id = EXCLUDED.business_id,
                    material_id = EXCLUDED.material_id,
                    transaction_type = EXCLUDED.transaction_type,
                    quantity = EXCLUDED.quantity,
                    unit_cost = EXCLUDED.unit_cost,
                    occurred_at = EXCLUDED.occurred_at,
                    idempotency_key = EXCLUDED.idempotency_key,
                    work_order_id = EXCLUDED.work_order_id,
                    note = EXCLUDED.note
                """,
                recordId, businessId, materialId, type, quantity, unitCost, occurredAt, idempotencyKey, workOrderId, note);
    }

    private void projectCustomerPayment(String businessId, String recordId, boolean isDelete, JsonNode p) {
        if (isDelete) {
            throw new IllegalArgumentException("Customer payments cannot be deleted.");
        }
        String customerId = text(p, "customerId", null);
        String billId = optText(p, "billId");
        BigDecimal amount = decimal(p, "amount", BigDecimal.ZERO);
        Timestamp receivedAt = parseTimestamp(optText(p, "receivedAt"));
        String idempotencyKey = text(p, "idempotencyKey", recordId);
        String method = optText(p, "method");
        String note = optText(p, "note");

        jdbc.update("""
                INSERT INTO customer_payments (
                    payment_id, business_id, customer_id, bill_id, amount,
                    received_at, idempotency_key, method, note)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (payment_id) DO UPDATE SET
                    business_id = EXCLUDED.business_id,
                    customer_id = EXCLUDED.customer_id,
                    bill_id = EXCLUDED.bill_id,
                    amount = EXCLUDED.amount,
                    received_at = EXCLUDED.received_at,
                    idempotency_key = EXCLUDED.idempotency_key,
                    method = EXCLUDED.method,
                    note = EXCLUDED.note
                """,
                recordId, businessId, customerId, billId, amount, receivedAt, idempotencyKey, method, note);
    }

    private void projectExpense(String businessId, String recordId, boolean isDelete, JsonNode p) {
        if (isDelete) {
            throw new IllegalArgumentException("Expenses cannot be deleted.");
        }
        String category = text(p, "category", "General");
        String description = text(p, "description", "Expense");
        BigDecimal amount = decimal(p, "amount", BigDecimal.ZERO);
        Timestamp incurredAt = parseTimestamp(optText(p, "incurredAt"));
        String idempotencyKey = text(p, "idempotencyKey", recordId);

        jdbc.update("""
                INSERT INTO expenses (
                    expense_id, business_id, category, description, amount,
                    incurred_at, idempotency_key)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (expense_id) DO UPDATE SET
                    business_id = EXCLUDED.business_id,
                    category = EXCLUDED.category,
                    description = EXCLUDED.description,
                    amount = EXCLUDED.amount,
                    incurred_at = EXCLUDED.incurred_at,
                    idempotency_key = EXCLUDED.idempotency_key
                """,
                recordId, businessId, category, description, amount, incurredAt, idempotencyKey);
    }

    private String text(JsonNode node, String field, String defaultValue) {
        JsonNode val = node.get(field);
        if (val != null && !val.isNull()) {
            String text = val.asText().trim();
            if (!text.isEmpty()) return text;
        }
        if (defaultValue == null) {
            throw new IllegalArgumentException("Required field missing: " + field);
        }
        return defaultValue;
    }

    private String optText(JsonNode node, String field) {
        JsonNode val = node.get(field);
        if (val == null || val.isNull()) return null;
        String text = val.asText().trim();
        return text.isEmpty() ? null : text;
    }

    private BigDecimal decimal(JsonNode node, String field, BigDecimal defaultValue) {
        JsonNode val = node.get(field);
        if (val != null && !val.isNull() && val.isNumber()) {
            return val.decimalValue();
        }
        if (val != null && !val.isNull()) {
            try {
                return new BigDecimal(val.asText().trim());
            } catch (NumberFormatException ignored) {
            }
        }
        return defaultValue;
    }

    private Date parseDate(String val) {
        if (val == null) return Date.valueOf(LocalDate.now());
        try {
            if (val.length() >= 10) {
                return Date.valueOf(val.substring(0, 10));
            }
            return Date.valueOf(LocalDate.now());
        } catch (IllegalArgumentException e) {
            return Date.valueOf(LocalDate.now());
        }
    }

    private Timestamp parseTimestamp(String val) {
        if (val == null) return Timestamp.from(OffsetDateTime.now().toInstant());
        try {
            return Timestamp.from(OffsetDateTime.parse(val).toInstant());
        } catch (DateTimeParseException e) {
            try {
                if (val.length() == 10) {
                    return Timestamp.from(LocalDate.parse(val).atStartOfDay(java.time.ZoneOffset.UTC).toInstant());
                }
            } catch (Exception ignored) {
            }
            return Timestamp.from(OffsetDateTime.now().toInstant());
        }
    }
}
