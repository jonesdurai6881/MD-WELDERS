# MD Welders Business Management

Offline-first business management for welding teams: a mobile-ready web app, Android shell, and Spring Boot synchronization API.

## Project layout

- `frontend/` — HTML, CSS, JavaScript application and local data/sync services
- `backend/` — Java 25, Spring Boot 3.5, Maven REST service
- `database/migrations/` — Oracle AI Database 26ai Flyway migrations
- `database/postgresql-migrations/` — Neon PostgreSQL Flyway migrations
- `android/` — Capacitor Android project configuration
- `tests/` — browser-independent business rule checks
- `documentation/` — architecture and operational notes

## Current status

The application is designed to work offline. On Android it uses SQLite through Capacitor Community SQLite; in a regular browser it uses IndexedDB. Business changes are committed locally before they are queued for synchronization. Work assignment collisions, overpayments, and insufficient stock are rejected by the local business layer. AI suggestions are previews only and are written only after explicit confirmation.

Cloud synchronization and the API are optional. Configure the service and either its Oracle or Neon PostgreSQL datasource before enabling sync. Frontend and backend builds have been validated in this workspace; native Android runtime, database connectivity, and live cloud synchronization still require deployment configuration and device/database testing.

**Deployment limitations:** this is a working starter, not a production-certified release. The device repositories store JSON records per entity and enforce relationships in the business layer; the Oracle and PostgreSQL migrations define normalized business tables, but the sync endpoint writes versioned JSON envelopes to `sync_records` and does not yet project them into those tables. The backend exposes sync endpoints rather than dedicated business CRUD/report APIs. The assistant uses a small local phrase parser, not a configured generative-AI service. Tenant-scoped bearer authentication, refresh/device sessions, Android Keystore token storage, account binding, and foreground/network-triggered synchronization are implemented. Automatic sync does not run while the app process is stopped; no Android WorkManager worker is configured. Cloud snapshot backup/restore is not implemented, and local SQLite data is not encrypted at rest. Database migrations, configured HTTPS deployment, and live multi-device synchronization still require validation before production use.

See [backend/README.md](backend/README.md) for the backend API contract, provisioning, migration, and backup limitations.

## Run the frontend

Install Node.js 22+ and npm, then:

```powershell
cd frontend
npm install
npm run dev
```

For Android, install Android Studio and an Android SDK, then:

```powershell
cd frontend
npm install
npx cap sync android
npx cap open android
```

The SQLite plugin requires the Android native runtime. Browser preview uses IndexedDB instead.
Copy `frontend/.env.example` to `frontend/.env.local` and set `VITE_API_BASE_URL` to the HTTPS backend address to enable synchronization. Credentials are prompted at sign-in; passwords are not persisted. Android session tokens are encrypted with an Android Keystore key; browser sessions use memory-only token storage.

## Run the backend

Install JDK 25 and Maven 3.9+. For Oracle, set `ORACLE_JDBC_URL`, `ORACLE_DB_USERNAME`, and `ORACLE_DB_PASSWORD`; Oracle remains the default datasource and its migrations and driver are retained. For Neon PostgreSQL, use the PostgreSQL profile described in [backend/README.md](backend/README.md). Set `MDWELDERS_ADMIN_USERNAME` and `MDWELDERS_ADMIN_PASSWORD_HASH` in either case. The password hash must be BCrypt encoded. Do not commit credentials.

```powershell
cd backend
mvn spring-boot:run
```

Flyway applies the Oracle migrations from `database/migrations` at startup when using the default profile. PostgreSQL uses its separate migration location. Set `MDWELDERS_CORS_ORIGINS` to the exact trusted app origins before exposing the API. Put the API behind HTTPS in any deployed environment.

## Offline and sync behavior

All essential app data is written to local storage first. Queued changes carry stable record IDs and idempotency keys; retries reuse the same keys unless the payload changes. The server applies an incoming record only when its base version matches the current version and reports conflicts instead of silently overwriting newer cloud data. A conflict stays in the local queue for review. Signed-in devices automatically sync on local changes, connectivity restoration, and app foregrounding; manual sync remains available. The sync UI displays pending uploads/downloads, failed changes, conflicts, progress, and registered devices. Each installation is bound to one business account to prevent its local outbox from being sent to a different tenant.

Local backups are versioned JSON exports. Restore validates the complete file before replacing data and asks for confirmation. Cloud snapshot backup/restore is not available.

## Employee management

The dashboard quick action and Employees page share the same Add Employee form. Employee records are saved to the active local database (IndexedDB in a browser, SQLite on Android) and are immediately available to employee details, team assignments, salary calculations, and the sync queue. Names and positive daily salary are required; joining date, contact details, job role, and photo are optional. Phone numbers are validated and duplicate phone numbers are rejected. Employee deletion is a synchronized soft delete; employees with outstanding salary remain protected so payment history is not lost.

## Business calculations

Profit is received customer payments minus recorded expenses for the selected period. Unpaid bills are reported separately and never included in income. Salary due is accrued work assignment pay minus recorded salary payments. Stock is purchase quantities minus usage quantities.

## Tests

With Node.js installed, run `npm test` from the `frontend` directory. The test command runs the standalone business-rule suite with Node's built-in test runner.

See [documentation/architecture.md](documentation/architecture.md) for boundaries, schema notes, security assumptions, and known deployment requirements.
