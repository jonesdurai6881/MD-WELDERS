package com.mdwelders.api.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class PostgresConnectionDetailsTest {
    @Test
    void convertsNeonUriWithoutPuttingUserInfoInJdbcUrl() {
        PostgresConnectionDetails details = PostgresConnectionDetails.fromConnectionString(
                "postgresql://test-user:p%40ss%2Bword@ep-example-pooler.region.aws.neon.tech:5432/welders"
                        + "?sslmode=require");

        assertEquals(
                "jdbc:postgresql://ep-example-pooler.region.aws.neon.tech:5432/welders?sslmode=require",
                details.jdbcUrl());
        assertEquals("test-user", details.username());
        assertEquals("p@ss+word", details.password());
    }

    @Test
    void rejectsMalformedUrlsWithoutIncludingTheInputInTheError() {
        IllegalArgumentException error = assertThrows(
                IllegalArgumentException.class,
                () -> PostgresConnectionDetails.fromConnectionString("not-a-postgres-url"));

        assertEquals("Invalid PostgreSQL connection string.", error.getMessage());
    }
}
