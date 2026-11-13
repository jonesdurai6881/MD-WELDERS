package com.mdwelders.api.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RefreshRequest(
        @NotBlank @Size(max = 128) String refreshToken,
        @NotBlank @Size(max = 160) String deviceId) { }
