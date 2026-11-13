package com.mdwelders.api.sync;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mdwelders.api.config.DatabaseDialect;
import com.mdwelders.api.sync.projection.OracleRelationalProjector;
import com.mdwelders.api.sync.projection.PostgresRelationalProjector;
import com.mdwelders.api.sync.projection.RelationalProjector;
import java.io.IOException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Service
public class SyncService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final DatabaseDialect databaseDialect;
    private final RelationalProjector relationalProjector;
    private final TransactionTemplate nestedTransactionTemplate;

    @Autowired
    public SyncService(
            JdbcTemplate jdbc,
            ObjectMapper objectMapper,
            @Value("${mdwelders.database.dialect:oracle}") String databaseDialect,
            PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.databaseDialect = DatabaseDialect.from(databaseDialect);
        if (this.databaseDialect == DatabaseDialect.POSTGRESQL) {
            this.relationalProjector = new PostgresRelationalProjector(jdbc);
        } else {
            this.relationalProjector = new OracleRelationalProjector(jdbc);
        }
        this.nestedTransactionTemplate = new TransactionTemplate(transactionManager);
        this.nestedTransactionTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_NESTED);
    }

    public SyncService(JdbcTemplate jdbc, ObjectMapper objectMapper, String databaseDialect) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.databaseDialect = DatabaseDialect.from(databaseDialect);
        if (this.databaseDialect == DatabaseDialect.POSTGRESQL) {
            this.relationalProjector = new PostgresRelationalProjector(jdbc);
        } else {
            this.relationalProjector = new OracleRelationalProjector(jdbc);
        }
        this.nestedTransactionTemplate = null;
    }

    public SyncService(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this(jdbc, objectMapper, "oracle");
    }

    public List<SyncResult> apply(List<SyncChange> changes, String businessId, String userId) {
        if (changes == null || changes.isEmpty()) {
            return List.of();
        }

        // Validate all payloads upfront before processing
        for (SyncChange change : changes) {
            validatePayload(change);
        }

        // 1. Sort changes topologically by entity dependency rank
        List<SyncChange> sortedChanges = new ArrayList<>(changes);
        sortedChanges.sort(Comparator.comparingInt(c -> dependencyRank(c.entityType())));

        // 2. Process each change isolated in its own savepoint/nested transaction
        Map<String, SyncResult> resultsByKey = new HashMap<>();
        for (SyncChange change : sortedChanges) {
            SyncResult result;
            if (nestedTransactionTemplate != null) {
                result = nestedTransactionTemplate.execute(status -> {
                    try {
                        return applyOne(change, businessId, userId);
                    } catch (ResponseStatusException rse) {
                        status.setRollbackOnly();
                        return new SyncResult(change.idempotencyKey(), "FAILED", 0L, rse.getReason());
                    } catch (DataIntegrityViolationException dive) {
                        status.setRollbackOnly();
                        String msg = dive.getMessage();
                        if (msg != null && (msg.contains("uq_active_employee_work_day") || msg.contains("uq_active_emp_tenant_work_day"))) {
                            return new SyncResult(change.idempotencyKey(), "CONFLICT", 0L,
                                    "Employee already has an active work assignment on this date.");
                        }
                        return new SyncResult(change.idempotencyKey(), "FAILED", 0L,
                            "Data integrity constraint violation: " + (dive.getMostSpecificCause() != null ? dive.getMostSpecificCause().getMessage() : dive.getMessage()));
                    } catch (Exception e) {
                        status.setRollbackOnly();
                        return new SyncResult(change.idempotencyKey(), "FAILED", 0L, e.getMessage());
                    }
                });
            } else {
                try {
                    result = applyOne(change, businessId, userId);
                } catch (ResponseStatusException rse) {
                    throw rse;
                } catch (DataIntegrityViolationException dive) {
                    String msg = dive.getMessage();
                    if (msg != null && (msg.contains("uq_active_employee_work_day") || msg.contains("uq_active_emp_tenant_work_day"))) {
                        result = new SyncResult(change.idempotencyKey(), "CONFLICT", 0L,
                                "Employee already has an active work assignment on this date.");
                    } else {
                        result = new SyncResult(change.idempotencyKey(), "FAILED", 0L,
                            "Data integrity constraint violation: " + (dive.getMostSpecificCause() != null ? dive.getMostSpecificCause().getMessage() : dive.getMessage()));
                    }
                } catch (Exception e) {
                    result = new SyncResult(change.idempotencyKey(), "FAILED", 0L, e.getMessage());
                }
            }
            resultsByKey.put(change.idempotencyKey(), result);
        }

        // 3. Return results preserving the exact original request order
        return changes.stream().map(c -> resultsByKey.get(c.idempotencyKey())).toList();
    }

    private static int dependencyRank(String entityType) {
        return switch (entityType) {
            case "customers", "employees", "materials" -> 1;
            case "workOrders" -> 2;
            case "assignments", "bills" -> 3;
            case "salaryPayments", "stockTransactions", "customerPayments", "expenses" -> 4;
            default -> 5;
        };
    }

    private SyncResult applyOne(SyncChange change, String businessId, String userId) {
        validatePayload(change);
        Optional<AppliedChange> previouslyApplied = jdbc.query(
                "SELECT entity_type, record_id, server_version FROM sync_queue "
                        + "WHERE business_id = ? AND idempotency_key = ?",
                resultSet -> resultSet.next()
                        ? Optional.of(new AppliedChange(resultSet.getString(1), resultSet.getString(2), resultSet.getLong(3)))
                        : Optional.empty(),
                businessId, change.idempotencyKey());
        if (previouslyApplied.isPresent()) {
            AppliedChange replay = previouslyApplied.get();
            if (!replay.entityType().equals(change.entityType()) || !replay.recordId().equals(change.recordId())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "The idempotency key was already used for a different record.");
            }
            return new SyncResult(change.idempotencyKey(), "APPLIED", replay.serverVersion(), null);
        }

        Optional<StoredRecord> existing = jdbc.query(
                "SELECT version_number, payload, is_deleted FROM sync_records "
                        + "WHERE business_id = ? AND entity_type = ? AND record_id = ? FOR UPDATE",
                resultSet -> resultSet.next()
                        ? Optional.of(new StoredRecord(
                                resultSet.getLong(1), resultSet.getString(2), resultSet.getInt(3)))
                        : Optional.empty(),
                businessId, change.entityType(), change.recordId());

        long currentVersion = existing.map(StoredRecord::version).orElse(0L);
        if (currentVersion != change.baseVersion()) {
            JsonNode serverPayload = existing.map(record -> parseStoredJson(record.payload())).orElse(null);
            return new SyncResult(change.idempotencyKey(), "CONFLICT", currentVersion,
                    "The cloud record has a newer version.", serverPayload,
                    existing.map(record -> record.deleted() == 1).orElse(false));
        }

        long newVersion = currentVersion + 1;
        String payload = json(change.payload());
        int deleted = change.operation().equals("DELETE") ? 1 : 0;
        Timestamp updatedAt = Timestamp.from(OffsetDateTime.now().toInstant());

        // A. Store envelope in sync_records
        if (databaseDialect == DatabaseDialect.POSTGRESQL) {
            jdbc.update("""
                    INSERT INTO sync_records (
                        business_id, entity_type, record_id, payload, version_number, is_deleted, updated_at)
                    VALUES (?, ?, ?, CAST(? AS jsonb), ?, ?, ?)
                    ON CONFLICT (business_id, entity_type, record_id) DO UPDATE SET
                        payload = EXCLUDED.payload,
                        version_number = EXCLUDED.version_number,
                        is_deleted = EXCLUDED.is_deleted,
                        updated_at = EXCLUDED.updated_at
                    """,
                    businessId, change.entityType(), change.recordId(), payload, newVersion, deleted, updatedAt);
        } else {
            jdbc.update("""
                    MERGE INTO sync_records target
                    USING (SELECT ? business_id, ? entity_type, ? record_id FROM dual) source
                    ON (target.business_id = source.business_id AND target.entity_type = source.entity_type
                        AND target.record_id = source.record_id)
                    WHEN MATCHED THEN UPDATE SET payload = ?, version_number = ?, is_deleted = ?, updated_at = ?
                    WHEN NOT MATCHED THEN INSERT (business_id, entity_type, record_id, payload, version_number, is_deleted, updated_at)
                      VALUES (source.business_id, source.entity_type, source.record_id, ?, ?, ?, ?)
                    """,
                    businessId, change.entityType(), change.recordId(), payload, newVersion, deleted, updatedAt,
                    payload, newVersion, deleted, updatedAt);
        }

        // B. Project envelope into normalized relational business tables
        relationalProjector.project(businessId, change.entityType(), change.recordId(), change.operation(), change.payload());

        // C. Record idempotency in sync_queue
        jdbc.update(
                "INSERT INTO sync_queue(business_id, idempotency_key, entity_type, record_id, operation_code, status_code, server_version) "
                        + "VALUES (?, ?, ?, ?, ?, 'APPLIED', ?)",
                businessId, change.idempotencyKey(), change.entityType(), change.recordId(), change.operation(), newVersion);

        // D. Record audit log
        if (databaseDialect == DatabaseDialect.POSTGRESQL) {
            jdbc.update(
                    "INSERT INTO audit_logs(audit_id, business_id, user_id, action_code, entity_type, record_id, details) "
                            + "VALUES (?, ?, ?, ?, ?, ?, CAST(? AS jsonb))",
                    UUID.randomUUID().toString(), businessId, userId, "SYNC_" + change.operation(), change.entityType(),
                    change.recordId(), "{\"version\":" + newVersion + "}");
        } else {
            jdbc.update(
                    "INSERT INTO audit_logs(audit_id, business_id, user_id, action_code, entity_type, record_id, details) "
                            + "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    UUID.randomUUID().toString(), businessId, userId, "SYNC_" + change.operation(), change.entityType(),
                    change.recordId(), "{\"version\":" + newVersion + "}");
        }
        return new SyncResult(change.idempotencyKey(), "APPLIED", newVersion, null);
    }

    public List<RemoteChange> changesSince(
            String businessId, OffsetDateTime since, String afterEntityType, String afterRecordId, int limit) {
        int boundedLimit = Math.min(Math.max(limit, 1), 1000);
        return jdbc.query(
                "SELECT entity_type, record_id, payload, version_number, is_deleted, updated_at "
                        + "FROM sync_records WHERE business_id = ? AND (updated_at > ? OR (updated_at = ? AND "
                        + "(entity_type > ? OR (entity_type = ? AND record_id > ?)))) "
                        + "ORDER BY updated_at, entity_type, record_id FETCH FIRST "
                        + boundedLimit + " ROWS ONLY",
                (resultSet, rowNumber) -> remoteChange(resultSet),
                businessId, Timestamp.from(since.toInstant()), Timestamp.from(since.toInstant()),
                afterEntityType, afterEntityType, afterRecordId);
    }

    public SyncStatus status(
            String businessId, OffsetDateTime since, String afterEntityType, String afterRecordId) {
        return jdbc.query(
                "SELECT COUNT(*) record_count, "
                        + "COUNT(CASE WHEN updated_at > ? OR (updated_at = ? AND "
                        + "(entity_type > ? OR (entity_type = ? AND record_id > ?))) THEN 1 END) available_count, "
                        + "MAX(updated_at) last_updated_at "
                        + "FROM sync_records WHERE business_id = ?",
                resultSet -> {
                    if (!resultSet.next()) {
                        return new SyncStatus(businessId, 0, 0, null);
                    }
                    Timestamp updatedAt = resultSet.getTimestamp("last_updated_at");
                    return new SyncStatus(
                            businessId, resultSet.getLong("record_count"), resultSet.getLong("available_count"),
                            updatedAt == null ? null : OffsetDateTime.ofInstant(updatedAt.toInstant(), java.time.ZoneOffset.UTC));
                },
                Timestamp.from(since.toInstant()), Timestamp.from(since.toInstant()),
                afterEntityType, afterEntityType, afterRecordId, businessId);
    }

    private RemoteChange remoteChange(ResultSet resultSet) throws SQLException {
        try {
            return new RemoteChange(
                    resultSet.getString("entity_type"),
                    resultSet.getString("record_id"),
                    objectMapper.readTree(resultSet.getString("payload")),
                    resultSet.getLong("version_number"),
                    resultSet.getInt("is_deleted") == 1,
                    resultSet.getTimestamp("updated_at").toInstant().toString());
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Stored sync data is not valid JSON.", exception);
        }
    }

    private String json(JsonNode payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Invalid sync payload.", exception);
        }
    }

    private void validatePayload(SyncChange change) {
        if (change.payload() == null || !change.payload().isObject()
                || !change.payload().path("id").isTextual()
                || !change.recordId().equals(change.payload().path("id").asText())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The sync payload must be an object with a matching record ID.");
        }
        try {
            if (objectMapper.writeValueAsBytes(change.payload()).length > 2_000_000) {
                throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "A sync record may not exceed 2 MB.");
            }
        } catch (IOException exception) {
            throw new IllegalArgumentException("Invalid sync payload.", exception);
        }
    }

    private JsonNode parseStoredJson(String payload) {
        try {
            return objectMapper.readTree(payload);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Stored sync data is not valid JSON.", exception);
        }
    }

    private record StoredRecord(long version, String payload, int deleted) { }
    private record AppliedChange(String entityType, String recordId, long serverVersion) { }
}
