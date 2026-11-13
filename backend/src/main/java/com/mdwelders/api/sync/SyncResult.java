package com.mdwelders.api.sync;

import com.fasterxml.jackson.databind.JsonNode;

public record SyncResult(
        String idempotencyKey,
        String status,
        long serverVersion,
        String error,
        JsonNode serverPayload,
        boolean serverDeleted) {
    public SyncResult(String idempotencyKey, String status, long serverVersion, String error) {
        this(idempotencyKey, status, serverVersion, error, null, false);
    }
}
