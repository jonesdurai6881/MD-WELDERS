package com.mdwelders.api.admin;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin")
public class AdminProvisioningController {
    private final AdminProvisioningService provisioningService;

    public AdminProvisioningController(AdminProvisioningService provisioningService) {
        this.provisioningService = provisioningService;
    }

    @PostMapping("/businesses")
    @ResponseStatus(HttpStatus.CREATED)
    public ProvisionedBusiness createBusiness(@Valid @RequestBody CreateBusinessRequest request) {
        return provisioningService.createBusiness(request);
    }

    @PostMapping("/businesses/{businessId}/users")
    @ResponseStatus(HttpStatus.CREATED)
    public ProvisionedUser createUser(
            @PathVariable String businessId,
            @Valid @RequestBody CreateUserRequest request) {
        return provisioningService.createUser(businessId, request);
    }
}
