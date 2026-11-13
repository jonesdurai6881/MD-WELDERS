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
public class OracleRelationalProjector implements RelationalProjector {
    private final JdbcTemplate jdbc;

    public OracleRelationalProjector(JdbcTemplate jdbc) {
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
                MERGE INTO employees target
                USING (SELECT ? emp_id, ? b_id, ? f_name, ? ph, ? addr, ? loc, ? j_date, ? d_sal, ? p_uri, ? act, ? upd, ? r_code FROM dual) src
                ON (target.employee_id = src.emp_id)
                WHEN MATCHED THEN UPDATE SET
                    target.business_id = src.b_id,
                    target.full_name = src.f_name,
                    target.phone = src.ph,
                    target.address = src.addr,
                    target.location = src.loc,
                    target.joining_date = src.j_date,
                    target.daily_salary = src.d_sal,
                    target.photo_uri = src.p_uri,
                    target.is_active = src.act,
                    target.updated_at = src.upd,
                    target.job_role = src.r_code
                WHEN NOT MATCHED THEN INSERT (
                    employee_id, business_id, full_name, phone, address, location,
                    joining_date, daily_salary, photo_uri, is_active, updated_at, job_role)
                VALUES (src.emp_id, src.b_id, src.f_name, src.ph, src.addr, src.loc,
                    src.j_date, src.d_sal, src.p_uri, src.act, src.upd, src.r_code)
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
                MERGE INTO customers target
                USING (SELECT ? cust_id, ? b_id, ? f_name, ? ph, ? em, ? addr, ? loc, ? upd, ? act FROM dual) src
                ON (target.customer_id = src.cust_id)
                WHEN MATCHED THEN UPDATE SET
                    target.business_id = src.b_id,
                    target.full_name = src.f_name,
                    target.phone = src.ph,
                    target.email = src.em,
                    target.address = src.addr,
                    target.location = src.loc,
                    target.updated_at = src.upd,
                    target.is_active = src.act
                WHEN NOT MATCHED THEN INSERT (
                    customer_id, business_id, full_name, phone, email, address, location, updated_at, is_active)
                VALUES (src.cust_id, src.b_id, src.f_name, src.ph, src.em, src.addr, src.loc, src.upd, src.act)
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
                MERGE INTO materials target
                USING (SELECT ? mat_id, ? b_id, ? m_name, ? m_unit, ? l_stock, ? upd, ? act FROM dual) src
                ON (target.material_id = src.mat_id)
                WHEN MATCHED THEN UPDATE SET
                    target.business_id = src.b_id,
                    target.name = src.m_name,
                    target.unit = src.m_unit,
                    target.low_stock_threshold = src.l_stock,
                    target.updated_at = src.upd,
                    target.is_active = src.act
                WHEN NOT MATCHED THEN INSERT (
                    material_id, business_id, name, unit, low_stock_threshold, updated_at, is_active)
                VALUES (src.mat_id, src.b_id, src.m_name, src.m_unit, src.l_stock, src.upd, src.act)
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
                MERGE INTO work_orders target
                USING (SELECT ? wo_id, ? b_id, ? cust_id, ? w_title, ? loc, ? w_date, ? stat, ? w_notes, ? upd FROM dual) src
                ON (target.work_order_id = src.wo_id)
                WHEN MATCHED THEN UPDATE SET
                    target.business_id = src.b_id,
                    target.customer_id = src.cust_id,
                    target.title = src.w_title,
                    target.job_location = src.loc,
                    target.work_date = src.w_date,
                    target.status_code = src.stat,
                    target.notes = src.w_notes,
                    target.updated_at = src.upd
                WHEN NOT MATCHED THEN INSERT (
                    work_order_id, business_id, customer_id, title, job_location,
                    work_date, status_code, notes, updated_at)
                VALUES (src.wo_id, src.b_id, src.cust_id, src.w_title, src.loc,
                    src.w_date, src.stat, src.w_notes, src.upd)
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
                MERGE INTO work_assignments target
                USING (SELECT ? a_id, ? b_id, ? wo_id, ? emp_id, ? w_date, ? rate, ? stat FROM dual) src
                ON (target.assignment_id = src.a_id)
                WHEN MATCHED THEN UPDATE SET
                    target.business_id = src.b_id,
                    target.work_order_id = src.wo_id,
                    target.employee_id = src.emp_id,
                    target.work_date = src.w_date,
                    target.daily_rate = src.rate,
                    target.assignment_status = src.stat
                WHEN NOT MATCHED THEN INSERT (
                    assignment_id, business_id, work_order_id, employee_id,
                    work_date, daily_rate, assignment_status)
                VALUES (src.a_id, src.b_id, src.wo_id, src.emp_id, src.w_date, src.rate, src.stat)
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
                MERGE INTO customer_bills target
                USING (SELECT ? b_id, ? bus_id, ? c_id, ? wo_id, ? b_num, ? amt, ? iss_at, ? descr FROM dual) src
                ON (target.bill_id = src.b_id)
                WHEN MATCHED THEN UPDATE SET
                    target.business_id = src.bus_id,
                    target.customer_id = src.c_id,
                    target.work_order_id = src.wo_id,
                    target.bill_number = src.b_num,
                    target.total_amount = src.amt,
                    target.issued_at = src.iss_at,
                    target.description = src.descr
                WHEN NOT MATCHED THEN INSERT (
                    bill_id, business_id, customer_id, work_order_id, bill_number,
                    total_amount, issued_at, description)
                VALUES (src.b_id, src.bus_id, src.c_id, src.wo_id, src.b_num, src.amt, src.iss_at, src.descr)
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
                MERGE INTO salary_transactions target
                USING (SELECT ? s_id, ? bus_id, ? emp_id, ? amt, ? p_at, ? idemp, ? s_note FROM dual) src
                ON (target.salary_transaction_id = src.s_id)
                WHEN MATCHED THEN UPDATE SET
                    target.business_id = src.bus_id,
                    target.employee_id = src.emp_id,
                    target.amount = src.amt,
                    target.paid_at = src.p_at,
                    target.idempotency_key = src.idemp,
                    target.note = src.s_note
                WHEN NOT MATCHED THEN INSERT (
                    salary_transaction_id, business_id, employee_id, amount,
                    paid_at, idempotency_key, note)
                VALUES (src.s_id, src.bus_id, src.emp_id, src.amt, src.p_at, src.idemp, src.s_note)
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
                MERGE INTO stock_transactions target
                USING (SELECT ? st_id, ? bus_id, ? mat_id, ? t_type, ? qty, ? u_cost, ? occ_at, ? idemp, ? wo_id, ? s_note FROM dual) src
                ON (target.stock_transaction_id = src.st_id)
                WHEN MATCHED THEN UPDATE SET
                    target.business_id = src.bus_id,
                    target.material_id = src.mat_id,
                    target.transaction_type = src.t_type,
                    target.quantity = src.qty,
                    target.unit_cost = src.u_cost,
                    target.occurred_at = src.occ_at,
                    target.idempotency_key = src.idemp,
                    target.work_order_id = src.wo_id,
                    target.note = src.s_note
                WHEN NOT MATCHED THEN INSERT (
                    stock_transaction_id, business_id, material_id, transaction_type,
                    quantity, unit_cost, occurred_at, idempotency_key, work_order_id, note)
                VALUES (src.st_id, src.bus_id, src.mat_id, src.t_type, src.qty, src.u_cost, src.occ_at, src.idemp, src.wo_id, src.s_note)
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
                MERGE INTO customer_payments target
                USING (SELECT ? cp_id, ? bus_id, ? c_id, ? b_id, ? amt, ? rec_at, ? idemp, ? p_meth, ? p_note FROM dual) src
                ON (target.payment_id = src.cp_id)
                WHEN MATCHED THEN UPDATE SET
                    target.business_id = src.bus_id,
                    target.customer_id = src.c_id,
                    target.bill_id = src.b_id,
                    target.amount = src.amt,
                    target.received_at = src.rec_at,
                    target.idempotency_key = src.idemp,
                    target.method = src.p_meth,
                    target.note = src.p_note
                WHEN NOT MATCHED THEN INSERT (
                    payment_id, business_id, customer_id, bill_id, amount,
                    received_at, idempotency_key, method, note)
                VALUES (src.cp_id, src.bus_id, src.c_id, src.b_id, src.amt, src.rec_at, src.idemp, src.p_meth, src.p_note)
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
                MERGE INTO expenses target
                USING (SELECT ? exp_id, ? bus_id, ? cat, ? descr, ? amt, ? inc_at, ? idemp FROM dual) src
                ON (target.expense_id = src.exp_id)
                WHEN MATCHED THEN UPDATE SET
                    target.business_id = src.bus_id,
                    target.category = src.cat,
                    target.description = src.descr,
                    target.amount = src.amt,
                    target.incurred_at = src.inc_at,
                    target.idempotency_key = src.idemp
                WHEN NOT MATCHED THEN INSERT (
                    expense_id, business_id, category, description, amount,
                    incurred_at, idempotency_key)
                VALUES (src.exp_id, src.bus_id, src.cat, src.descr, src.amt, src.inc_at, src.idemp)
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
