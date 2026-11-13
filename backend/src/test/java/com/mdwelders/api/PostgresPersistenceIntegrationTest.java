package com.mdwelders.api;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mdwelders.api.admin.AdminProvisioningService;
import com.mdwelders.api.admin.CreateAdministratorRequest;
import com.mdwelders.api.admin.CreateBusinessRequest;
import com.mdwelders.api.auth.AuthService;
import com.mdwelders.api.auth.AuthenticatedAccount;
import com.mdwelders.api.auth.BearerTokenFilter;
import com.mdwelders.api.auth.LoginRequest;
import com.mdwelders.api.devices.DeviceService;
import com.mdwelders.api.sync.SyncChange;
import com.mdwelders.api.sync.SyncService;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE)
@ActiveProfiles("postgresql")
class PostgresPersistenceIntegrationTest {
    private static final String POSTGRESQL_DIALECT = "postgresql";
    private static final String BUSINESS_NAME = "Integration Welding";
    private static final String USERNAME = "pg-integration-owner";
    private static final String PASSWORD = "integration-test-password";

    @Container
    private static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");

    @Autowired
    private JdbcTemplate jdbc;

    @DynamicPropertySource
    static void setConnectionStrings(DynamicPropertyRegistry registry) {
        registry.add("DATABASE_URL", PostgresPersistenceIntegrationTest::connectionString);
        registry.add("DATABASE_URL_UNPOOLED", PostgresPersistenceIntegrationTest::connectionString);
        registry.add("MDWELDERS_ADMIN_USERNAME", () -> "integration-admin");
        registry.add("MDWELDERS_ADMIN_PASSWORD_HASH", () -> "unused-test-password-hash");
    }

    private static String connectionString() {
        String jdbcUrl = POSTGRES.getJdbcUrl().substring("jdbc:".length());
        int authorityStart = jdbcUrl.indexOf("://") + 3;
        return jdbcUrl.substring(0, authorityStart)
                + POSTGRES.getUsername() + ":" + POSTGRES.getPassword() + "@"
                + jdbcUrl.substring(authorityStart);
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void flywayCreatesTenantSchemaAndSeedsLegacyBusiness() {
        assertEquals(1, jdbc.queryForObject(
                "SELECT COUNT(*) FROM businesses WHERE business_name = ?", Integer.class, "Legacy Business"));
        assertEquals(1, jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.tables "
                        + "WHERE table_schema = current_schema() AND table_name = 'device_sessions'",
                Integer.class));
        assertEquals(1, jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.table_constraints "
                        + "WHERE table_schema = current_schema() AND constraint_name = 'pk_sync_records_tenant'",
                Integer.class));
    }

    @Test
    void realAuthDeviceAndSyncQueriesPreserveIdempotencyAndConflictHandling() throws Exception {
        BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
        AdminProvisioningService provisioning = new AdminProvisioningService(jdbc, passwordEncoder);
        var business = provisioning.createBusiness(new CreateBusinessRequest(
                BUSINESS_NAME, new CreateAdministratorRequest(USERNAME, PASSWORD)));

        AuthService auth = new AuthService(jdbc, passwordEncoder, 15, 30, POSTGRESQL_DIALECT);
        var token = auth.login(new LoginRequest(USERNAME, PASSWORD, "pg-device", "Integration device", "TEST"));
        assertEquals(business.businessId(), token.businessId());
        assertNotNull(token.accessToken());

        assertEquals(1, new DeviceService(jdbc).list(new AuthenticatedAccount(
                business.businessId(),
                business.administrator().userId(),
                USERNAME,
                "ADMIN",
                jdbc.queryForObject(
                        "SELECT session_id FROM device_sessions WHERE user_id = ? AND device_id = ?",
                        String.class,
                        business.administrator().userId(),
                        "pg-device"))).size());

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer " + token.accessToken());
        new BearerTokenFilter(jdbc).doFilter(
                request, new MockHttpServletResponse(), new MockFilterChain());
        assertTrue(SecurityContextHolder.getContext().getAuthentication().isAuthenticated());

        ObjectMapper objectMapper = new ObjectMapper();
        SyncService sync = new SyncService(jdbc, objectMapper, POSTGRESQL_DIALECT);
        String recordId = "01aa0000-0000-4000-8000-000000000101";
        String firstKey = "01aa0000-0000-4000-8000-000000000102";
        SyncChange change = new SyncChange(
                firstKey,
                "employees",
                recordId,
                "UPSERT",
                objectMapper.readTree("{\"id\":\"" + recordId + "\",\"fullName\":\"Local copy\"}"),
                0);

        var applied = sync.apply(List.of(change), business.businessId(), business.administrator().userId()).getFirst();
        assertEquals("APPLIED", applied.status());
        assertEquals(1, applied.serverVersion());
        var replay = sync.apply(List.of(change), business.businessId(), business.administrator().userId()).getFirst();
        assertEquals("APPLIED", replay.status());
        assertEquals(1, replay.serverVersion());

        SyncChange staleChange = new SyncChange(
                "01aa0000-0000-4000-8000-000000000103",
                "employees",
                recordId,
                "UPSERT",
                objectMapper.readTree("{\"id\":\"" + recordId + "\",\"fullName\":\"Stale copy\"}"),
                0);
        var conflict = sync.apply(
                List.of(staleChange), business.businessId(), business.administrator().userId()).getFirst();
        assertEquals("CONFLICT", conflict.status());
        assertEquals("Local copy", conflict.serverPayload().path("fullName").asText());
        assertFalse(conflict.serverDeleted());

        var status = sync.status(
                business.businessId(), OffsetDateTime.parse("1970-01-01T00:00:00Z"), "", "");
        assertEquals(1, status.recordCount());
        assertEquals(1, jdbc.queryForObject(
                "SELECT COUNT(*) FROM audit_logs WHERE business_id = ?", Integer.class, business.businessId()));
    }
}
