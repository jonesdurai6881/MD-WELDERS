package com.mdwelders.api.auth;

import java.time.Instant;

public record TokenResponse(String accessToken, String refreshToken, Instant expiresAt, String businessId) { }
