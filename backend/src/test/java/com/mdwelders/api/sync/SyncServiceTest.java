package com.mdwelders.api.sync;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Proxy;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;

class SyncServiceTest {
    private static final String RECORD_ID = "01aa0000-0000-4000-8000-000000000001";
    private static final String IDEMPOTENCY_KEY = "01aa0000-0000-4000-8000-000000000002";
    private static final String BUSINESS_ID = "01aa0000-0000-4000-8000-000000000003";
    private static final String USER_ID = "01aa0000-0000-4000-8000-000000000004";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RecordingJdbcTemplate jdbc = new RecordingJdbcTemplate();
    private SyncService service;

    @BeforeEach
    void setUp() {
        jdbc.reset();
        service = new SyncService(jdbc, objectMapper);
    }

    @Test
    void appliesANewRecordOnceAndReturnsItsServerVersion() throws Exception {
        SyncResult result = service.apply(List.of(change(RECORD_ID)), BUSINESS_ID, USER_ID).getFirst();

        assertEquals("APPLIED", result.status());
        assertEquals(1, result.serverVersion());
        // 4 updates: sync_records envelope, relational projection, sync_queue idempotency, audit_logs
        assertEquals(4, jdbc.updates.size());
        assertEquals(BUSINESS_ID, jdbc.updateArgs.getFirst()[0]);
        assertEquals(BUSINESS_ID, jdbc.updateArgs.get(2)[0]);
    }

    @Test
    void replaysTheOriginalVersionWithoutApplyingTheChangeAgain() throws Exception {
        jdbc.alreadyApplied = row(
                "entity_type", "employees",
                "record_id", RECORD_ID,
                "server_version", 4L);

        SyncResult result = service.apply(List.of(change(RECORD_ID)), BUSINESS_ID, USER_ID).getFirst();

        assertEquals("APPLIED", result.status());
        assertEquals(4, result.serverVersion());
        assertEquals(0, jdbc.updates.size());
        assertEquals(1, jdbc.queryCount);
        assertEquals(BUSINESS_ID, jdbc.queryArgs.getFirst()[0]);
        assertEquals(IDEMPOTENCY_KEY, jdbc.queryArgs.getFirst()[1]);
    }

    @Test
    void reportsTheCurrentCloudVersionInsteadOfOverwritingAConflict() throws Exception {
        String remoteJson = "{\"id\":\"" + RECORD_ID + "\",\"fullName\":\"Cloud copy\"}";
        jdbc.currentRecord = row("version_number", 3L, "payload", remoteJson, "is_deleted", 0);

        SyncResult result = service.apply(List.of(change(RECORD_ID)), BUSINESS_ID, USER_ID).getFirst();

        assertEquals("CONFLICT", result.status());
        assertEquals(3, result.serverVersion());
        assertEquals("Cloud copy", result.serverPayload().path("fullName").asText());
        assertEquals(0, jdbc.updates.size());
    }

    @Test
    void rejectsPayloadsWhoseRecordIdDoesNotMatchTheEnvelope() throws Exception {
        SyncChange change = new SyncChange(
                IDEMPOTENCY_KEY,
                "employees",
                RECORD_ID,
                "UPSERT",
                objectMapper.readTree("{\"id\":\"different-id\"}"),
                0);

        ResponseStatusException error = assertThrows(
                ResponseStatusException.class,
                () -> service.apply(List.of(change), BUSINESS_ID, USER_ID));

        assertEquals(HttpStatus.BAD_REQUEST, error.getStatusCode());
        assertEquals(0, jdbc.queryCount);
    }

    @Test
    void isolatesIdempotencyAndRecordLocksByBusiness() throws Exception {
        jdbc.alreadyApplied = row("entity_type", "employees", "record_id", RECORD_ID, "server_version", 2L);

        service.apply(List.of(change(RECORD_ID)), BUSINESS_ID, USER_ID);

        assertEquals(BUSINESS_ID, jdbc.queryArgs.getFirst()[0]);
        assertEquals(IDEMPOTENCY_KEY, jdbc.queryArgs.getFirst()[1]);
        assertTrue(jdbc.queries.getFirst().contains("business_id = ? AND idempotency_key = ?"));
    }

    @Test
    void scopesChangeQueriesToTheAuthenticatedBusiness() {
        service.changesSince(BUSINESS_ID, OffsetDateTime.parse("2026-01-01T00:00:00Z"), "", "", 50);

        assertTrue(jdbc.queries.getFirst().contains("business_id = ?"));
        assertEquals(BUSINESS_ID, jdbc.queryArgs.getFirst()[0]);
    }

    @Test
    void reportsTenantScopedServerAvailabilityAfterTheSuppliedCursor() {
        jdbc.currentRecord = row(
                "record_count", 8L,
                "available_count", 3L,
                "last_updated_at", Timestamp.from(OffsetDateTime.parse("2026-01-02T00:00:00Z").toInstant()));
        OffsetDateTime since = OffsetDateTime.parse("2026-01-01T00:00:00Z");

        SyncStatus status = service.status(BUSINESS_ID, since, "customers", RECORD_ID);

        assertEquals(8, status.recordCount());
        assertEquals(3, status.availableToDownloadCount());
        assertEquals(BUSINESS_ID, status.businessId());
        assertTrue(jdbc.queries.getFirst().contains("WHERE business_id = ?"));
        assertEquals(BUSINESS_ID, jdbc.queryArgs.getFirst()[5]);
        assertEquals(Timestamp.from(since.toInstant()), jdbc.queryArgs.getFirst()[0]);
    }

    private SyncChange change(String recordId) throws Exception {
        JsonNode payload = objectMapper.readTree("{\"id\":\"" + recordId + "\",\"fullName\":\"Local copy\"}");
        return new SyncChange(IDEMPOTENCY_KEY, "employees", recordId, "UPSERT", payload, 0);
    }

    private static Map<String, Object> row(Object... columns) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int index = 0; index < columns.length; index += 2) {
            result.put((String) columns[index], columns[index + 1]);
        }
        return result;
    }

    private static ResultSet resultSet(Map<String, Object> row) {
        boolean[] returned = {false};
        List<Object> columns = row == null ? List.of() : new ArrayList<>(row.values());
        return (ResultSet) Proxy.newProxyInstance(
                ResultSet.class.getClassLoader(),
                new Class<?>[] {ResultSet.class},
                (proxy, method, arguments) -> {
                    if (method.getName().equals("next")) {
                        if (row == null || returned[0]) {
                            return false;
                        }
                        returned[0] = true;
                        return true;
                    }
                    if (method.getName().equals("getString")) {
                        Object key = arguments[0];
                        Object value = key instanceof Integer
                                ? columns.get((Integer) key - 1)
                                : row.get(key);
                        return value == null ? null : value.toString();
                    }
                    if (method.getName().equals("getLong")) {
                        Object key = arguments[0];
                        return ((Number) (key instanceof Integer
                                ? columns.get((Integer) key - 1)
                                : row.get(key))).longValue();
                    }
                    if (method.getName().equals("getInt")) {
                        Object key = arguments[0];
                        Object value = key instanceof Integer
                                ? columns.get((Integer) key - 1)
                                : row.get(key);
                        return ((Number) value).intValue();
                    }
                    if (method.getName().equals("getTimestamp")) {
                        return row.get(arguments[0]);
                    }
                    if (method.getName().equals("wasNull")) {
                        return false;
                    }
                    return null;
                });
    }

    private static final class RecordingJdbcTemplate extends JdbcTemplate {
        private final List<String> updates = new ArrayList<>();
        private final List<Object[]> updateArgs = new ArrayList<>();
        private final List<String> queries = new ArrayList<>();
        private final List<Object[]> queryArgs = new ArrayList<>();
        private Map<String, Object> alreadyApplied;
        private Map<String, Object> currentRecord;
        private int queryCount;

        private void reset() {
            updates.clear();
            updateArgs.clear();
            queries.clear();
            queryArgs.clear();
            alreadyApplied = null;
            currentRecord = null;
            queryCount = 0;
        }

        @Override
        public <T> T query(String sql, ResultSetExtractor<T> extractor, Object... args) {
            queryCount++;
            queries.add(sql);
            queryArgs.add(args);
            Map<String, Object> row = sql.contains("FROM sync_queue")
                    ? alreadyApplied
                    : currentRecord;
            try {
                return extractor.extractData(resultSet(row));
            } catch (SQLException exception) {
                throw new IllegalStateException(exception);
            }
        }

        @Override
        public <T> List<T> query(String sql, RowMapper<T> rowMapper, Object... args) {
            queries.add(sql);
            queryArgs.add(args);
            return List.of();
        }

        @Override
        public int update(String sql, Object... args) {
            updates.add(sql);
            updateArgs.add(args);
            return 1;
        }
    }
}
