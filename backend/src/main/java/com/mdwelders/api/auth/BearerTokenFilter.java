package com.mdwelders.api.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

public class BearerTokenFilter extends OncePerRequestFilter {
    private final JdbcTemplate jdbc;

    public BearerTokenFilter(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring("Bearer ".length()).trim();
            if (!token.isEmpty()) {
                List<Map<String, Object>> sessions = jdbc.queryForList("""
                        SELECT s.business_id, s.user_id, u.username, u.role_code, s.session_id
                        FROM device_sessions s
                        JOIN app_users u ON u.user_id = s.user_id
                        JOIN businesses b ON b.business_id = s.business_id
                        WHERE s.access_token_hash = ? AND s.access_expires_at > CURRENT_TIMESTAMP
                          AND s.revoked_at IS NULL AND u.is_active = 1 AND b.is_active = 1
                        """, AuthService.tokenHash(token));
                if (sessions.size() == 1) {
                    Map<String, Object> session = sessions.getFirst();
                    AuthenticatedAccount account = new AuthenticatedAccount(
                            (String) session.get("BUSINESS_ID"),
                            (String) session.get("USER_ID"),
                            (String) session.get("USERNAME"),
                            (String) session.get("ROLE_CODE"),
                            (String) session.get("SESSION_ID"));
                    SecurityContextHolder.getContext().setAuthentication(
                            new UsernamePasswordAuthenticationToken(
                                    account, null,
                                    List.of(new SimpleGrantedAuthority("ROLE_" + account.roleCode()))));
                    jdbc.update("UPDATE device_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_id = ?",
                            account.sessionId());
                }
            }
        }
        filterChain.doFilter(request, response);
    }
}
