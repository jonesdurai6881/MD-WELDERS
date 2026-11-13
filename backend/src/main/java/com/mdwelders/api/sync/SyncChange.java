package com.mdwelders.api.sync;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record SyncChange(
        @NotBlank @Size(max = 80) String idempotencyKey,
        @NotBlank @Pattern(regexp = "employees|customers|workOrders|assignments|salaryPayments|materials|stockTransactions|bills|customerPayments|expenses|aiProposals|settings")
        String entityType,
        @NotBlank @Size(max = 36) String recordId,
        @NotBlank @Pattern(regexp = "UPSERT|DELETE") String operation,
        @NotNull JsonNode payload,
        @PositiveOrZero long baseVersion) {
}
