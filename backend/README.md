# Backend authentication and sync contract

The API uses stateless bearer access tokens backed by revocable database device sessions. Access tokens are short-lived (15 minutes by default); refresh tokens are rotated at every refresh and last 30 days by default. Override with `MDWELDERS_ACCESS_TOKEN_MINUTES` and `MDWELDERS_REFRESH_TOKEN_DAYS`. The database stores SHA-256 token hashes only. Account passwords are BCrypt hashes. Oracle remains the default database; Neon PostgreSQL is selected explicitly with the `postgresql` Spring profile.

## Client contract

All bodies and responses are JSON. User endpoints require `Authorization: Bearer <accessToken>`, except login and refresh. The `businessId` is selected from the authenticated account/session; clients must not send a tenant ID to sync endpoints.

### Login and refresh

`POST /api/v1/auth/login`

```json
{"username":"user","password":"user-provided-password","deviceId":"stable-client-id","deviceName":"Android phone","platform":"ANDROID"}
```

Response: `{"accessToken":"…","refreshToken":"…","expiresAt":"<UTC ISO-8601 instant>","businessId":"<stable opaque tenant ID>"}`. The stable `businessId` is non-secret and is returned by both login and refresh so a client can bind its local database/outbox before syncing.

`POST /api/v1/auth/refresh`

```json
{"refreshToken":"…","deviceId":"stable-client-id"}
```

Response has the same shape as login, including the same `businessId` for the authenticated account. Each successful refresh invalidates the submitted refresh token. `POST /api/v1/auth/logout` takes no body and revokes the bearer token's current device session; response is `204 No Content`.

### Devices

`GET /api/v1/devices` returns device sessions for the authenticated business, including revoked sessions, with `deviceId`, `userId`, `deviceName`, `platform`, `createdAt`, `lastSeenAt`, `revokedAt`, and `current`.

`DELETE /api/v1/devices/{deviceId}` revokes active sessions with that device ID in the authenticated business and returns `204 No Content`. Business account admins may revoke any device in their business. Members may revoke only their own devices. Unknown/already-revoked devices return `404`.

### Sync

`POST /api/v1/sync/batch` keeps the existing `SyncChange[]` request and `SyncResult[]` response semantics, with a 100-record maximum. It requires a bearer token. Records, idempotency keys, conflict checks, audit entries, and pull results are isolated by the authenticated business. No request field can select another business.

`GET /api/v1/sync/changes?since=<ISO-8601>&afterEntityType=<type>&afterRecordId=<id>&limit=<n>` returns the existing `RemoteChange[]` shape, scoped to the authenticated business. `since` is required; the cursor fields default to empty and `limit` defaults to 500 (maximum 1000).

`GET /api/v1/sync/status?since=<ISO-8601>&afterEntityType=<type>&afterRecordId=<id>` returns:

```json
{"businessId":"…","recordCount":12,"availableToDownloadCount":3,"lastUpdatedAt":"<UTC ISO-8601 timestamp>"}
```

The cursor parameters are optional; without `since`, availability is counted from the Unix epoch (the business's full current sync record set). Supply the same cursor as `/changes` to get its remaining server-side record count. The count includes tombstones because deletions are delivered as versioned changes.

### Protected provisioning

No public registration endpoint exists. `POST /api/v1/admin/businesses` creates a business and its first `ADMIN` user; `POST /api/v1/admin/businesses/{businessId}/users` provisions a user with `ADMIN` or `MEMBER` role. Both require HTTP Basic credentials from `MDWELDERS_ADMIN_USERNAME` and BCrypt `MDWELDERS_ADMIN_PASSWORD_HASH`; those credentials are accepted only under `/api/v1/admin/**`. Provisioning request passwords must be supplied by the provisioning operator and are stored only as BCrypt hashes. Use HTTPS.

## Migration and operational notes

Flyway migration `V3__tenant_auth_and_device_sessions.sql` creates the business and session tables, assigns all pre-existing users and business records to a `Legacy Business`, adds non-null tenant IDs, and changes sync primary keys to include the tenant without deleting existing rows. Review the legacy business's user access before production rollout. Apply migrations with the configured Oracle account before enabling clients; the account needs privileges to create/alter tables, constraints, and indexes. PostgreSQL has its own V1–V3 migration set under `database/postgresql-migrations`; it is packaged at a separate Flyway location and is never applied by the default Oracle profile.

### Deployment configuration checklist

The application intentionally has no checked-in deployment credentials or production API URL. Supply configuration through the hosting platform's secret manager/environment settings; do not commit `.env` files, passwords, database wallets, access tokens, or generated hashes.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ORACLE_JDBC_URL` | Yes | JDBC URL for the target Oracle database, using the provider's TLS/wallet guidance. |
| `ORACLE_DB_USERNAME` | Yes | Schema account used by Spring JDBC and Flyway. |
| `ORACLE_DB_PASSWORD` | Yes | Secret for the schema account. |
| `MDWELDERS_ADMIN_USERNAME` | Yes | Protected platform administrator used only for `/api/v1/admin/**`. |
| `MDWELDERS_ADMIN_PASSWORD_HASH` | Yes | BCrypt hash for the platform administrator password; never store the plaintext password here. |
| `MDWELDERS_CORS_ORIGINS` | Production | Comma-separated exact trusted app origins; do not use `*`. |
| `PORT` | Optional | Hosting platform's HTTP listener port; defaults to `8080`. |
| `MDWELDERS_ACCESS_TOKEN_MINUTES` | Optional | Access token lifetime; defaults to `15`. |
| `MDWELDERS_REFRESH_TOKEN_DAYS` | Optional | Rotating refresh token lifetime; defaults to `30`. |

### Neon PostgreSQL profile

The Neon profile uses the pooled `DATABASE_URL` for Spring JDBC traffic and the direct `DATABASE_URL_UNPOOLED` for Flyway. The profile parses the standard PostgreSQL URI into JDBC connection settings on the server. Spring Boot does not load the repository's `.env.local` automatically, so load the variables through your local process environment or the deployment platform's secret manager. Never put either connection string in frontend variables, source control, or the Android application.

Set these server-side environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `SPRING_PROFILES_ACTIVE` | Yes | Set to `postgresql` to select the Neon profile. |
| `DATABASE_URL` | Yes | Neon pooled PostgreSQL connection string for runtime application queries. |
| `DATABASE_URL_UNPOOLED` | Yes | Neon direct PostgreSQL connection string used by Flyway. |
| `MDWELDERS_ADMIN_USERNAME` | Yes | Protected platform administrator used only for `/api/v1/admin/**`. |
| `MDWELDERS_ADMIN_PASSWORD_HASH` | Yes | BCrypt hash for the platform administrator password. |
| `MDWELDERS_CORS_ORIGINS` | Production | Comma-separated exact trusted app origins. |

Flyway runs at application startup using the direct URL and needs schema DDL privileges. Before the first startup, inspect the target in Neon and verify it is the intended new project/database and branch. These migrations create the schema and seed the `Legacy Business` tenant; they do not import Oracle or device-local records. Do not point the profile at an existing Oracle database or an existing Neon database that should not receive these migrations.

### Deploying on Render

Render does not provide a native Java runtime; use its Docker runtime ([language support](https://render.com/docs/language-support), [Docker deployment](https://render.com/docs/docker)). Create a Render Web Service with the repository root as the Docker context and `backend/Dockerfile` as the Dockerfile path. The image builds the backend and starts the JAR. In the Render service's environment settings ([environment variables](https://render.com/docs/configure-environment-variables)), configure `SPRING_PROFILES_ACTIVE=postgresql`, add `DATABASE_URL` and `DATABASE_URL_UNPOOLED` from the intended Neon project, and set the administrator and CORS variables above. Keep the connection strings in Render's secret environment settings, not in `render.yaml` or repository files. Render supplies `PORT`; the application already binds to it. The root `.dockerignore` excludes local env files, frontend assets, Android builds, and local build outputs from the Docker context.

The start command triggers Flyway against the direct Neon URL. Confirm the Neon project, database, and branch before deploying; there is no automatic Oracle-to-Neon or SQLite-to-Neon data migration. Keep the frontend pointed at the HTTPS Render API using only `VITE_API_BASE_URL`; do not provide database credentials to the frontend.

Before exposing the API: provision a dedicated test Oracle database and business account; take a verified database backup; validate the migration plan against that database; apply and inspect Flyway migrations; configure HTTPS at the trusted reverse proxy; restrict ingress and CORS; provision the platform administrator through the secret manager; then provision tenant users using the protected admin API. The current service uses one datasource account for both runtime queries and Flyway startup migrations, so it requires schema DDL privileges at startup; a separate migration job/runtime credential split is not implemented. Do not configure `frontend/.env.local` or build a connected APK until the HTTPS API and test account are ready. `VITE_API_BASE_URL` is intentionally blank in `frontend/.env.example`, so a default build does not enable cloud sync.

Cloud backup snapshot export/import is not implemented. Do not treat sync endpoints as a snapshot restore API: import/restore requires a separately designed, tenant-validated process that merges records as versioned changes and never destructively overwrites data.
