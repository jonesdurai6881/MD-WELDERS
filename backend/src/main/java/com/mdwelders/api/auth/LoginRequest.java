package com.mdwelders.api.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record LoginRequest(
        @NotBlank @Size(max = 120) String username,
        @NotBlank @Size(max = 200) String password,
        @NotBlank @Size(max = 160) String deviceId,
        @NotBlank @Size(max = 160) String deviceName,
        @NotBlank @Size(max = 40) String platform) { }
