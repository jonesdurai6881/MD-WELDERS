package com.mdwelders.api.config;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

public record PostgresConnectionDetails(String jdbcUrl, String username, String password) {
    public static PostgresConnectionDetails fromConnectionString(String connectionString) {
        try {
            URI uri = new URI(connectionString);
            String scheme = uri.getScheme();
            if (!"postgresql".equalsIgnoreCase(scheme) && !"postgres".equalsIgnoreCase(scheme)) {
                throw invalidConnectionString();
            }
            String host = uri.getHost();
            String userInfo = uri.getRawUserInfo();
            String path = uri.getRawPath();
            if (host == null || userInfo == null || path == null || path.length() < 2) {
                throw invalidConnectionString();
            }
            int separator = userInfo.indexOf(':');
            if (separator <= 0 || separator == userInfo.length() - 1) {
                throw invalidConnectionString();
            }
            if (host.indexOf(':') >= 0 && !host.startsWith("[")) {
                host = "[" + host + "]";
            }
            String jdbcUrl = "jdbc:postgresql://" + host
                    + (uri.getPort() < 0 ? "" : ":" + uri.getPort())
                    + path
                    + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
            return new PostgresConnectionDetails(
                    jdbcUrl,
                    decode(userInfo.substring(0, separator)),
                    decode(userInfo.substring(separator + 1)));
        } catch (URISyntaxException | IllegalArgumentException exception) {
            throw invalidConnectionString();
        }
    }

    private static String decode(String value) {
        try {
            return URLDecoder.decode(value.replace("+", "%2B"), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException exception) {
            throw invalidConnectionString();
        }
    }

    private static IllegalArgumentException invalidConnectionString() {
        return new IllegalArgumentException("Invalid PostgreSQL connection string.");
    }
}
