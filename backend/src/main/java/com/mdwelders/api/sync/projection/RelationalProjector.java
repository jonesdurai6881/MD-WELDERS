package com.mdwelders.api.sync.projection;

import com.fasterxml.jackson.databind.JsonNode;

public interface RelationalProjector {
    void project(String businessId, String entityType, String recordId, String operation, JsonNode payload);
}
