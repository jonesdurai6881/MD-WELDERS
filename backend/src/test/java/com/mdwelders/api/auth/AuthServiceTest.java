package com.mdwelders.api.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.server.ResponseStatusException;

class AuthServiceTest {
    private final JdbcTemplate jdbc = org.mockito.Mockito.mock(JdbcTemplate.class);
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private AuthService service;

    @BeforeEach
    void setUp() {
        service = new AuthService(jdbc, passwordEncoder, 15, 30);
    }

    @Test
    void loginIssuesDistinctOpaqueTokensAndStoresOnlyTheirHashes() {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of(account()));
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);

        TokenResponse response = service.login(
                new LoginRequest("welder", "correct horse battery", "phone-1", "Android phone", "ANDROID"));

        assertNotEquals(response.accessToken(), response.refreshToken());
        assertTrue(response.expiresAt().isAfter(java.time.Instant.now()));
        assertEquals("business-1", response.businessId());
        ArgumentCaptor<Object[]> arguments = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).update(anyString(), arguments.capture());
        List<Object> storedValues = Arrays.asList(arguments.getValue());
        assertTrue(storedValues.contains(AuthService.tokenHash(response.accessToken())));
        assertTrue(storedValues.contains(AuthService.tokenHash(response.refreshToken())));
        assertTrue(!storedValues.contains(response.accessToken()));
        assertTrue(!storedValues.contains(response.refreshToken()));
    }

    @Test
    void loginRejectsIncorrectPasswordsWithoutCreatingSessions() {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of(account()));

        ResponseStatusException error = assertThrows(
                ResponseStatusException.class,
                () -> service.login(new LoginRequest(
                        "welder", "wrong password", "phone-1", "Android phone", "ANDROID")));

        assertEquals(401, error.getStatusCode().value());
        org.mockito.Mockito.verify(jdbc, org.mockito.Mockito.never()).update(anyString(), any(Object[].class));
    }

    @Test
    void refreshRotatesBothTokensAndRejectsAnAlreadyRotatedToken() {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(
                List.of(Map.of("SESSION_ID", "session-1", "USER_ID", "user-1", "BUSINESS_ID", "business-1")));
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);

        TokenResponse response = service.refresh(new RefreshRequest("old-refresh-token", "phone-1"));

        assertNotEquals("old-refresh-token", response.refreshToken());
        assertNotEquals(response.accessToken(), response.refreshToken());
        assertEquals("business-1", response.businessId());
        ArgumentCaptor<String> query = ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForList(query.capture(), any(Object[].class));
        assertTrue(query.getValue().contains("s.revoked_at IS NULL"));
        assertTrue(query.getValue().contains("s.device_id = ?"));
    }

    @Test
    void refreshRejectsUnknownOrRevokedSessions() {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());

        ResponseStatusException error = assertThrows(
                ResponseStatusException.class,
                () -> service.refresh(new RefreshRequest("revoked-token", "phone-1")));

        assertEquals(401, error.getStatusCode().value());
        org.mockito.Mockito.verify(jdbc, org.mockito.Mockito.never()).update(anyString(), any(Object[].class));
    }

    @Test
    void logoutRevokesOnlyTheAuthenticatedAccountDeviceSession() {
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);
        AuthenticatedAccount account =
                new AuthenticatedAccount("business-1", "user-1", "welder", "MEMBER", "session-1");

        service.logout(account);

        ArgumentCaptor<String> query = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> arguments = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).update(query.capture(), arguments.capture());
        assertTrue(query.getValue().contains("WHERE session_id = ? AND user_id = ? AND business_id = ?"));
        org.junit.jupiter.api.Assertions.assertArrayEquals(
                new Object[] {"session-1", "user-1", "business-1"}, arguments.getValue());
    }

    private Map<String, Object> account() {
        return Map.of(
                "USER_ID", "user-1",
                "BUSINESS_ID", "business-1",
                "USERNAME", "welder",
                "PASSWORD_HASH", passwordEncoder.encode("correct horse battery"),
                "ROLE_CODE", "ADMIN");
    }
}
