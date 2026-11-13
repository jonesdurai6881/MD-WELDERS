package com.mdwelders.api.devices;

import java.time.OffsetDateTime;

public record DeviceInfo(
        String deviceId,
        String userId,
        String deviceName,
        String platform,
        OffsetDateTime createdAt,
        OffsetDateTime lastSeenAt,
        OffsetDateTime revokedAt,
        boolean current) { }
