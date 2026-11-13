package com.mdwelders.api.admin;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateBusinessRequest(
        @NotBlank @Size(max = 160) String businessName,
        @NotNull @Valid CreateAdministratorRequest administrator) { }
