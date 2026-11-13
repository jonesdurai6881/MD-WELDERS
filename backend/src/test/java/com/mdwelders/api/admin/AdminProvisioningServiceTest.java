package com.mdwelders.api.admin;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

class AdminProvisioningServiceTest {
    private final JdbcTemplate jdbc = org.mockito.Mockito.mock(JdbcTemplate.class);
    private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder();
    private final AdminProvisioningService service = new AdminProvisioningService(jdbc, passwordEncoder);

    @Test
    void createsBusinessAndAlwaysProvisionsItsFirstUserAsAdminWithAHash() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any(Object[].class))).thenReturn(0);
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);

        ProvisionedBusiness result = service.createBusiness(new CreateBusinessRequest(
                "Welding company",
                new CreateAdministratorRequest("owner", "a long operator-supplied password")));

        assertEquals("ADMIN", result.administrator().role());
        ArgumentCaptor<Object[]> arguments = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc, times(2)).update(anyString(), arguments.capture());
        List<Object[]> calls = arguments.getAllValues();
        Object[] insertedUser = calls.stream()
                .filter(call -> call.length == 5)
                .findFirst()
                .orElseThrow();
        assertEquals(result.businessId(), insertedUser[1]);
        assertEquals("owner", insertedUser[2]);
        assertTrue(passwordEncoder.matches("a long operator-supplied password", (String) insertedUser[3]));
        assertEquals("ADMIN", insertedUser[4]);
    }

    @Test
    void provisionsNewMembersIntoTheRequestedActiveBusiness() {
        when(jdbc.queryForObject(anyString(), eq(Integer.class), any(Object[].class))).thenReturn(1, 0);
        when(jdbc.update(anyString(), any(Object[].class))).thenReturn(1);

        ProvisionedUser result = service.createUser(
                "business-1", new CreateUserRequest("staff", "a long operator-supplied password", "MEMBER"));

        assertEquals("MEMBER", result.role());
        ArgumentCaptor<String> query = ArgumentCaptor.forClass(String.class);
        verify(jdbc, times(2)).queryForObject(query.capture(), eq(Integer.class), any(Object[].class));
        assertTrue(query.getAllValues().stream().anyMatch(
                sql -> sql.contains("business_id = ? AND is_active = 1")));
    }
}
