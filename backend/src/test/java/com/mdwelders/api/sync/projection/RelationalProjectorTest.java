package com.mdwelders.api.sync.projection;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class RelationalProjectorTest {
    private static final String BUSINESS_ID = "01aa0000-0000-4000-8000-000000000001";
    private static final String RECORD_ID = "01aa0000-0000-4000-8000-000000000002";

    private final ObjectMapper mapper = new ObjectMapper();
    private final RecordingJdbcTemplate jdbc = new RecordingJdbcTemplate();
    private PostgresRelationalProjector postgresProjector;
    private OracleRelationalProjector oracleProjector;

    @BeforeEach
    void setUp() {
        jdbc.reset();
        postgresProjector = new PostgresRelationalProjector(jdbc);
        oracleProjector = new OracleRelationalProjector(jdbc);
    }

    @Test
    void postgresProjectsEmployeeCorrectly() throws Exception {
        var payload = mapper.readTree("""
                {
                    "id": "%s",
                    "fullName": "Suresh Welder",
                    "dailySalary": 650.00,
                    "phone": "9876543210",
                    "role": "MIG Specialist",
                    "isActive": true
                }
                """.formatted(RECORD_ID));

        postgresProjector.project(BUSINESS_ID, "employees", RECORD_ID, "UPSERT", payload);

        assertEquals(1, jdbc.updates.size());
        assertTrue(jdbc.updates.getFirst().contains("INSERT INTO employees"));
        assertTrue(jdbc.updates.getFirst().contains("ON CONFLICT (employee_id) DO UPDATE"));
        assertEquals(RECORD_ID, jdbc.updateArgs.getFirst()[0]);
        assertEquals(BUSINESS_ID, jdbc.updateArgs.getFirst()[1]);
        assertEquals("Suresh Welder", jdbc.updateArgs.getFirst()[2]);
        assertEquals("9876543210", jdbc.updateArgs.getFirst()[3]);
        assertEquals("MIG Specialist", jdbc.updateArgs.getFirst()[11]);
    }

    @Test
    void oracleProjectsEmployeeCorrectly() throws Exception {
        var payload = mapper.readTree("""
                {
                    "id": "%s",
                    "fullName": "Suresh Welder",
                    "dailySalary": 650.00,
                    "phone": "9876543210",
                    "role": "MIG Specialist",
                    "isActive": true
                }
                """.formatted(RECORD_ID));

        oracleProjector.project(BUSINESS_ID, "employees", RECORD_ID, "UPSERT", payload);

        assertEquals(1, jdbc.updates.size());
        assertTrue(jdbc.updates.getFirst().contains("MERGE INTO employees target"));
        assertEquals(RECORD_ID, jdbc.updateArgs.getFirst()[0]);
        assertEquals(BUSINESS_ID, jdbc.updateArgs.getFirst()[1]);
        assertEquals("Suresh Welder", jdbc.updateArgs.getFirst()[2]);
        assertEquals("MIG Specialist", jdbc.updateArgs.getFirst()[11]);
    }

    @Test
    void projectsWorkOrderWithNullCustomerWhenEmpty() throws Exception {
        var payload = mapper.readTree("""
                {
                    "id": "%s",
                    "customerId": "",
                    "title": "Shop Gate Repair",
                    "workDate": "2026-11-20",
                    "status": "IN_PROGRESS"
                }
                """.formatted(RECORD_ID));

        postgresProjector.project(BUSINESS_ID, "workOrders", RECORD_ID, "UPSERT", payload);

        assertEquals(1, jdbc.updates.size());
        // customerId should be null
        assertEquals(null, jdbc.updateArgs.getFirst()[2]);
        assertEquals("Shop Gate Repair", jdbc.updateArgs.getFirst()[3]);
        assertEquals("IN_PROGRESS", jdbc.updateArgs.getFirst()[6]);
    }

    @Test
    void projectsCancelledAssignmentOnDelete() throws Exception {
        var payload = mapper.readTree("""
                {
                    "id": "%s",
                    "workOrderId": "wo-1",
                    "employeeId": "emp-1",
                    "workDate": "2026-11-20",
                    "dailyRate": 500,
                    "deleted": true
                }
                """.formatted(RECORD_ID));

        postgresProjector.project(BUSINESS_ID, "assignments", RECORD_ID, "DELETE", payload);

        assertEquals(1, jdbc.updates.size());
        assertEquals("CANCELLED", jdbc.updateArgs.getFirst()[6]);
    }

    @Test
    void rejectsFinancialTransactionHardDeletes() throws Exception {
        var salaryPayload = mapper.readTree("""
                {
                    "id": "%s",
                    "employeeId": "emp-1",
                    "amount": 500,
                    "paidAt": "2026-11-20"
                }
                """.formatted(RECORD_ID));

        assertThrows(IllegalArgumentException.class, () ->
                postgresProjector.project(BUSINESS_ID, "salaryPayments", RECORD_ID, "DELETE", salaryPayload));

        var expensePayload = mapper.readTree("""
                {
                    "id": "%s",
                    "category": "Fuel",
                    "description": "Diesel for generator",
                    "amount": 250,
                    "incurredAt": "2026-11-20"
                }
                """.formatted(RECORD_ID));

        assertThrows(IllegalArgumentException.class, () ->
                oracleProjector.project(BUSINESS_ID, "expenses", RECORD_ID, "DELETE", expensePayload));
    }

    private static final class RecordingJdbcTemplate extends JdbcTemplate {
        private final List<String> updates = new ArrayList<>();
        private final List<Object[]> updateArgs = new ArrayList<>();

        private void reset() {
            updates.clear();
            updateArgs.clear();
        }

        @Override
        public int update(String sql, Object... args) {
            updates.add(sql);
            updateArgs.add(args);
            return 1;
        }
    }
}
