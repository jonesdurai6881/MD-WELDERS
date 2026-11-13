package com.mdwelders.api.sync;

import com.fasterxml.jackson.databind.JsonNode;

public record RemoteChange(
        String entityType,
        String recordId,
        JsonNode payload,
        long serverVersion,
        boolean deleted,
        String updatedAt) {
}
