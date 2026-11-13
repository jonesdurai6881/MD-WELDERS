package com.mdwelders.api.config;

import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.flyway.FlywayConfigurationCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;

@Configuration
@Profile("postgresql")
public class PostgresDataSourceConfiguration {
    @Bean
    @Primary
    public HikariDataSource dataSource(@Value("${DATABASE_URL}") String connectionString) {
        PostgresConnectionDetails details = PostgresConnectionDetails.fromConnectionString(connectionString);
        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl(details.jdbcUrl());
        dataSource.setUsername(details.username());
        dataSource.setPassword(details.password());
        return dataSource;
    }

    @Bean
    public FlywayConfigurationCustomizer postgresFlywayConfiguration(
            @Value("${DATABASE_URL_UNPOOLED}") String connectionString) {
        PostgresConnectionDetails details = PostgresConnectionDetails.fromConnectionString(connectionString);
        return configuration -> configuration.dataSource(
                details.jdbcUrl(), details.username(), details.password());
    }
}
