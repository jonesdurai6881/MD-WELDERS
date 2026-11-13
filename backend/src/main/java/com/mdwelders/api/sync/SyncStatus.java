package com.mdwelders.api.sync;

import java.time.OffsetDateTime;

public record SyncStatus(
        String businessId,
        long recordCount,
        long availableToDownloadCount,
        OffsetDateTime lastUpdatedAt) { }
