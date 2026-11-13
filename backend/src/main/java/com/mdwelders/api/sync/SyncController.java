package com.mdwelders.api.sync;

import com.mdwelders.api.auth.AuthenticatedAccount;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/v1/sync")
public class SyncController {
    private final SyncService syncService;

    public SyncController(SyncService syncService) {
        this.syncService = syncService;
    }

    @PostMapping("/batch")
    public List<SyncResult> apply(
            @AuthenticationPrincipal AuthenticatedAccount account,
            @RequestBody @Size(max = 100) List<@Valid SyncChange> changes) {
        if (changes.size() > 100) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE, "A sync batch may contain at most 100 records.");
        }
        return syncService.apply(changes, account.businessId(), account.userId());
    }

    @GetMapping("/changes")
    public List<RemoteChange> changes(
            @AuthenticationPrincipal AuthenticatedAccount account,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime since,
            @RequestParam(defaultValue = "") String afterEntityType,
            @RequestParam(defaultValue = "") String afterRecordId,
            @RequestParam(defaultValue = "500") int limit) {
        if (limit < 1 || limit > 1000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The sync page limit must be between 1 and 1000.");
        }
        return syncService.changesSince(account.businessId(), since, afterEntityType, afterRecordId, limit);
    }

    @GetMapping("/status")
    public SyncStatus status(
            @AuthenticationPrincipal AuthenticatedAccount account,
            @RequestParam(defaultValue = "1970-01-01T00:00:00Z")
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) OffsetDateTime since,
            @RequestParam(defaultValue = "") String afterEntityType,
            @RequestParam(defaultValue = "") String afterRecordId) {
        return syncService.status(account.businessId(), since, afterEntityType, afterRecordId);
    }
}
