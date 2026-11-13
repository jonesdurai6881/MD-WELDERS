package com.mdwelders.api.admin;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record CreateUserRequest(
        @NotBlank @Size(max = 120) String username,
        @NotBlank @Size(min = 12, max = 200) String password,
        @NotBlank @Pattern(regexp = "ADMIN|MEMBER") String role) { }
