package com.mdwelders.api.devices;

import com.mdwelders.api.auth.AuthenticatedAccount;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class DeviceService {
    private final JdbcTemplate jdbc;

    public DeviceService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<DeviceInfo> list(AuthenticatedAccount account) {
        return jdbc.query("""
                SELECT device_id, user_id, device_name, platform, created_at, last_seen_at,
                       revoked_at, session_id
                FROM device_sessions
                WHERE business_id = ?
                ORDER BY created_at DESC
                """, (resultSet, rowNumber) -> deviceInfo(resultSet, account),
                account.businessId());
    }

    @Transactional
    public void revoke(AuthenticatedAccount account, String deviceId) {
        String sql = account.isBusinessAdmin()
                ? "UPDATE device_sessions SET revoked_at = CURRENT_TIMESTAMP "
                        + "WHERE business_id = ? AND device_id = ? AND revoked_at IS NULL"
                : "UPDATE device_sessions SET revoked_at = CURRENT_TIMESTAMP "
                        + "WHERE business_id = ? AND user_id = ? AND device_id = ? AND revoked_at IS NULL";
        int updated = account.isBusinessAdmin()
                ? jdbc.update(sql, account.businessId(), deviceId)
                : jdbc.update(sql, account.businessId(), account.userId(), deviceId);
        if (updated == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Active device not found.");
        }
    }

    private static DeviceInfo deviceInfo(ResultSet resultSet, AuthenticatedAccount account) throws SQLException {
        return new DeviceInfo(
                resultSet.getString("device_id"),
                resultSet.getString("user_id"),
                resultSet.getString("device_name"),
                resultSet.getString("platform"),
                resultSet.getObject("created_at", java.time.OffsetDateTime.class),
                resultSet.getObject("last_seen_at", java.time.OffsetDateTime.class),
                resultSet.getObject("revoked_at", java.time.OffsetDateTime.class),
                account.sessionId().equals(resultSet.getString("session_id")));
    }
}
