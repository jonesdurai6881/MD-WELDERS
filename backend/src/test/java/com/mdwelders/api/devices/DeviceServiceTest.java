package com.mdwelders.api.devices;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.mdwelders.api.auth.AuthenticatedAccount;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class DeviceServiceTest {
    private final JdbcTemplate jdbc = org.mockito.Mockito.mock(JdbcTemplate.class);
    private final DeviceService service = new DeviceService(jdbc);

    @Test
    void deviceListingIsFilteredByTheAuthenticatedBusiness() {
        when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class))).thenReturn(List.of());

        service.list(new AuthenticatedAccount("business-1", "user-1", "admin", "ADMIN", "session-1"));

        ArgumentCaptor<String> query = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> arguments = ArgumentCaptor.forClass(Object[].class);
        org.mockito.Mockito.verify(jdbc).query(query.capture(), any(RowMapper.class), arguments.capture());
        assertTrue(query.getValue().contains("WHERE business_id = ?"));
        org.junit.jupiter.api.Assertions.assertEquals("business-1", arguments.getValue()[0]);
    }

    @Test
    void membersCanRevokeOnlyTheirOwnBusinessDevice() {
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);

        service.revoke(new AuthenticatedAccount("business-1", "user-1", "member", "MEMBER", "session-1"), "phone-2");

        ArgumentCaptor<String> query = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> arguments = ArgumentCaptor.forClass(Object[].class);
        org.mockito.Mockito.verify(jdbc).update(query.capture(), arguments.capture());
        assertTrue(query.getValue().contains("business_id = ? AND user_id = ? AND device_id = ?"));
        org.junit.jupiter.api.Assertions.assertArrayEquals(
                new Object[] {"business-1", "user-1", "phone-2"}, arguments.getValue());
    }

    @Test
    void businessAdminsCanRevokeAnyDeviceInTheirBusinessOnly() {
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);

        service.revoke(new AuthenticatedAccount("business-1", "admin-1", "admin", "ADMIN", "session-1"), "phone-2");

        ArgumentCaptor<String> query = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> arguments = ArgumentCaptor.forClass(Object[].class);
        org.mockito.Mockito.verify(jdbc).update(query.capture(), arguments.capture());
        assertTrue(query.getValue().contains("WHERE business_id = ? AND device_id = ?"));
        org.junit.jupiter.api.Assertions.assertArrayEquals(
                new Object[] {"business-1", "phone-2"}, arguments.getValue());
    }
}
