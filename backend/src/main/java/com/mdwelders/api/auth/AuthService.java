package com.mdwelders.api.auth;

import com.mdwelders.api.config.DatabaseDialect;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthService {
    private static final SecureRandom RANDOM = new SecureRandom();

    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;
    private final long accessTokenMinutes;
    private final long refreshTokenDays;
    private final DatabaseDialect databaseDialect;

    @Autowired
    public AuthService(
            JdbcTemplate jdbc,
            PasswordEncoder passwordEncoder,
            @Value("${MDWELDERS_ACCESS_TOKEN_MINUTES:15}") long accessTokenMinutes,
            @Value("${MDWELDERS_REFRESH_TOKEN_DAYS:30}") long refreshTokenDays,
            @Value("${mdwelders.database.dialect:oracle}") String databaseDialect) {
        if (accessTokenMinutes < 1 || refreshTokenDays < 1) {
            throw new IllegalArgumentException("Token lifetimes must be positive.");
        }
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.accessTokenMinutes = accessTokenMinutes;
        this.refreshTokenDays = refreshTokenDays;
        this.databaseDialect = DatabaseDialect.from(databaseDialect);
    }

    public AuthService(
            JdbcTemplate jdbc,
            PasswordEncoder passwordEncoder,
            long accessTokenMinutes,
            long refreshTokenDays) {
        this(jdbc, passwordEncoder, accessTokenMinutes, refreshTokenDays, "oracle");
    }

    @Transactional
    public TokenResponse login(LoginRequest request) {
        List<Map<String, Object>> accounts = jdbc.queryForList(
                "SELECT u.user_id, u.business_id, u.username, u.password_hash, u.role_code "
                        + "FROM app_users u JOIN businesses b ON b.business_id = u.business_id "
                        + "WHERE u.username = ? AND u.is_active = 1 AND b.is_active = 1",
                request.username());
        if (accounts.size() != 1
                || !passwordEncoder.matches(request.password(), (String) accounts.getFirst().get("PASSWORD_HASH"))) {
            throw unauthorized();
        }

        Map<String, Object> account = accounts.getFirst();
        String accessToken = newToken();
        String refreshToken = newToken();
        Instant now = Instant.now();
        Instant accessExpiresAt = now.plusSeconds(accessTokenMinutes * 60);
        Instant refreshExpiresAt = now.plusSeconds(refreshTokenDays * 86400);
        String sessionId = UUID.randomUUID().toString();
        if (databaseDialect == DatabaseDialect.POSTGRESQL) {
            jdbc.update("""
                    INSERT INTO device_sessions (
                        session_id, business_id, user_id, device_id, device_name, platform,
                        access_token_hash, access_expires_at, refresh_token_hash, refresh_expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (user_id, device_id) DO UPDATE SET
                        business_id = EXCLUDED.business_id,
                        device_name = EXCLUDED.device_name,
                        platform = EXCLUDED.platform,
                        access_token_hash = EXCLUDED.access_token_hash,
                        access_expires_at = EXCLUDED.access_expires_at,
                        refresh_token_hash = EXCLUDED.refresh_token_hash,
                        refresh_expires_at = EXCLUDED.refresh_expires_at,
                        revoked_at = NULL,
                        last_seen_at = CURRENT_TIMESTAMP
                    """,
                    sessionId, account.get("BUSINESS_ID"), account.get("USER_ID"), request.deviceId(),
                    request.deviceName(), request.platform(), tokenHash(accessToken), timestamp(accessExpiresAt),
                    tokenHash(refreshToken), timestamp(refreshExpiresAt));
        } else {
            jdbc.update("""
                    MERGE INTO device_sessions target
                    USING (SELECT ? user_id, ? device_id FROM dual) source
                    ON (target.user_id = source.user_id AND target.device_id = source.device_id)
                    WHEN MATCHED THEN UPDATE SET
                        business_id = ?, device_name = ?, platform = ?, access_token_hash = ?,
                        access_expires_at = ?, refresh_token_hash = ?, refresh_expires_at = ?,
                        revoked_at = NULL, last_seen_at = CURRENT_TIMESTAMP
                    WHEN NOT MATCHED THEN INSERT (
                        session_id, business_id, user_id, device_id, device_name, platform,
                        access_token_hash, access_expires_at, refresh_token_hash, refresh_expires_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    account.get("USER_ID"), request.deviceId(),
                    account.get("BUSINESS_ID"), request.deviceName(), request.platform(), tokenHash(accessToken),
                    timestamp(accessExpiresAt), tokenHash(refreshToken), timestamp(refreshExpiresAt),
                    sessionId, account.get("BUSINESS_ID"), account.get("USER_ID"), request.deviceId(),
                    request.deviceName(), request.platform(), tokenHash(accessToken), timestamp(accessExpiresAt),
                    tokenHash(refreshToken), timestamp(refreshExpiresAt));
        }
        return new TokenResponse(
                accessToken, refreshToken, accessExpiresAt, (String) account.get("BUSINESS_ID"));
    }

    @Transactional
    public TokenResponse refresh(RefreshRequest request) {
        List<Map<String, Object>> sessions = jdbc.queryForList("""
                SELECT s.session_id, s.user_id, s.business_id
                FROM device_sessions s
                JOIN app_users u ON u.user_id = s.user_id
                JOIN businesses b ON b.business_id = s.business_id
                WHERE s.refresh_token_hash = ? AND s.device_id = ?
                  AND s.revoked_at IS NULL AND s.refresh_expires_at > CURRENT_TIMESTAMP
                  AND u.is_active = 1 AND b.is_active = 1
                """, tokenHash(request.refreshToken()), request.deviceId());
        if (sessions.size() != 1) {
            throw unauthorized();
        }

        Map<String, Object> session = sessions.getFirst();
        String newAccessToken = newToken();
        String newRefreshToken = newToken();
        Instant accessExpiresAt = Instant.now().plusSeconds(accessTokenMinutes * 60);
        Instant refreshExpiresAt = Instant.now().plusSeconds(refreshTokenDays * 86400);
        int updated = jdbc.update("""
                UPDATE device_sessions
                SET access_token_hash = ?, access_expires_at = ?, refresh_token_hash = ?,
                    refresh_expires_at = ?, last_seen_at = CURRENT_TIMESTAMP
                WHERE session_id = ? AND refresh_token_hash = ? AND revoked_at IS NULL
                """,
                tokenHash(newAccessToken), timestamp(accessExpiresAt), tokenHash(newRefreshToken),
                timestamp(refreshExpiresAt), session.get("SESSION_ID"), tokenHash(request.refreshToken()));
        if (updated != 1) {
            throw unauthorized();
        }
        return new TokenResponse(
                newAccessToken, newRefreshToken, accessExpiresAt, (String) session.get("BUSINESS_ID"));
    }

    @Transactional
    public void logout(AuthenticatedAccount account) {
        jdbc.update(
                "UPDATE device_sessions SET revoked_at = CURRENT_TIMESTAMP "
                        + "WHERE session_id = ? AND user_id = ? AND business_id = ? AND revoked_at IS NULL",
                account.sessionId(), account.userId(), account.businessId());
    }

    private static OffsetDateTime timestamp(Instant instant) {
        return instant.atOffset(java.time.ZoneOffset.UTC);
    }

    private static String newToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    static String tokenHash(String token) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable.", exception);
        }
    }

    private static ResponseStatusException unauthorized() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid credentials or session.");
    }
}
