package com.mdwelders.api.devices;

import com.mdwelders.api.auth.AuthenticatedAccount;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/devices")
public class DeviceController {
    private final DeviceService deviceService;

    public DeviceController(DeviceService deviceService) {
        this.deviceService = deviceService;
    }

    @GetMapping
    public List<DeviceInfo> list(@AuthenticationPrincipal AuthenticatedAccount account) {
        return deviceService.list(account);
    }

    @DeleteMapping("/{deviceId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(
            @AuthenticationPrincipal AuthenticatedAccount account,
            @PathVariable String deviceId) {
        deviceService.revoke(account, deviceId);
    }
}
