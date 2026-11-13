package com.mdwelders.api.config;

import java.util.Locale;

public enum DatabaseDialect {
    ORACLE,
    POSTGRESQL;

    public static DatabaseDialect from(String value) {
        return switch (value.toLowerCase(Locale.ROOT)) {
            case "oracle" -> ORACLE;
            case "postgresql" -> POSTGRESQL;
            default -> throw new IllegalArgumentException("Unsupported database dialect: " + value);
        };
    }
}
