package com.mdwelders.api.auth;

public record AuthenticatedAccount(
        String businessId,
        String userId,
        String username,
        String roleCode,
        String sessionId) {
    public boolean isBusinessAdmin() {
        return "ADMIN".equals(roleCode);
    }
}
