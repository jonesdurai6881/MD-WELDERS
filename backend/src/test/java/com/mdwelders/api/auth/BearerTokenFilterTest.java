package com.mdwelders.api.auth;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.security.core.context.SecurityContextHolder;

class BearerTokenFilterTest {
    private final JdbcTemplate jdbc = org.mockito.Mockito.mock(JdbcTemplate.class);

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void missingOrRevokedBearerTokensNeverAuthenticateTheRequest() throws Exception {
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer a-revoked-access-token");

        new BearerTokenFilter(jdbc).doFilter(
                request, new MockHttpServletResponse(), new MockFilterChain());

        assertFalse(SecurityContextHolder.getContext().getAuthentication() != null
                && SecurityContextHolder.getContext().getAuthentication().isAuthenticated());
        org.mockito.ArgumentCaptor<String> query = org.mockito.ArgumentCaptor.forClass(String.class);
        org.mockito.Mockito.verify(jdbc).queryForList(query.capture(), any(Object[].class));
        assertTrue(query.getValue().contains("s.revoked_at IS NULL"));
        assertTrue(query.getValue().contains("s.access_expires_at > CURRENT_TIMESTAMP"));
    }
}
