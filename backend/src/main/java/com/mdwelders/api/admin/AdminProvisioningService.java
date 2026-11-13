package com.mdwelders.api.admin;

import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AdminProvisioningService {
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;

    public AdminProvisioningService(JdbcTemplate jdbc, PasswordEncoder passwordEncoder) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public ProvisionedBusiness createBusiness(CreateBusinessRequest request) {
        ensureUsernameAvailable(request.administrator().username());
        String businessId = UUID.randomUUID().toString();
        String userId = UUID.randomUUID().toString();
        jdbc.update("INSERT INTO businesses(business_id, business_name) VALUES (?, ?)",
                businessId, request.businessName().trim());
        insertUser(businessId, userId, new CreateUserRequest(
                request.administrator().username(), request.administrator().password(), "ADMIN"));
        return new ProvisionedBusiness(
                businessId, request.businessName().trim(),
                new ProvisionedUser(userId, request.administrator().username(), "ADMIN"));
    }

    @Transactional
    public ProvisionedUser createUser(String businessId, CreateUserRequest request) {
        ensureBusinessExists(businessId);
        ensureUsernameAvailable(request.username());
        String userId = UUID.randomUUID().toString();
        insertUser(businessId, userId, request);
        return new ProvisionedUser(userId, request.username(), request.role());
    }

    private void insertUser(String businessId, String userId, CreateUserRequest request) {
        jdbc.update("""
                INSERT INTO app_users(user_id, business_id, username, password_hash, role_code, is_active)
                VALUES (?, ?, ?, ?, ?, 1)
                """,
                userId, businessId, request.username().trim(),
                passwordEncoder.encode(request.password()), request.role());
    }

    private void ensureUsernameAvailable(String username) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM app_users WHERE username = ?", Integer.class, username.trim());
        if (count != null && count > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "That username is already provisioned.");
        }
    }

    private void ensureBusinessExists(String businessId) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM businesses WHERE business_id = ? AND is_active = 1",
                Integer.class, businessId);
        if (count == null || count == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Business not found.");
        }
    }
}
