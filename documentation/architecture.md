# Architecture and data boundaries

## Components

- The frontend owns presentation, offline operations, local validation, backup, reports, and the sync queue.
- Native Android uses `@capacitor-community/sqlite`. A browser uses IndexedDB through the same repository interface.
- The Spring Boot API accepts versioned, idempotent change batches and exposes synchronization status. It never replaces device data on a conflict.
- Flyway owns Oracle schema changes. The migration defines normalized business tables and a JSON-backed sync envelope for incremental replication.

## Offline persistence

Each local record has a stable UUID, an update timestamp, and a tombstone marker on deletion. The outbox is written in the same local transaction as the record change. Successfully acknowledged changes are removed from the queue; failed and conflicted changes remain available for retry or review.

The browser store is for development and browser use. Android must be built and verified with the native SQLite plugin and Android SDK before production release.

## Financial invariants

- Customer bill totals and payments are separate. Income reports sum received payments only.
- An expense is recorded once as an expense; salary payments and material purchases are expenses, not additional payment-side copies.
- Salary is accrued from assigned daily rates. Payments cannot exceed the employee's unpaid balance.
- Material use cannot make available stock negative.
- A work assignment is unique per employee per work date.
- AI extraction produces an editable draft. The user must confirm before a financial transaction is stored.

## API and security

Business API requests use short-lived, opaque bearer access tokens backed by registered device sessions; refresh tokens rotate on use, and sessions can be revoked. Passwords and stored token values are hashed. `POST /api/v1/admin/**` alone uses the environment-configured platform administrator's HTTP Basic credentials to provision businesses and users; Basic authentication is disabled on sync and user endpoints. Sync derives the business from the authenticated session. Configure HTTPS at the reverse proxy, restrict CORS to known origins, and see `backend/README.md` for exact contracts and required environment configuration.

Oracle credentials, API credentials, and AI provider keys must be supplied through deployment secrets. The assistant uses a centralized local rule-based tool service over device records; no external AI provider is configured, and no business query is sent to an AI API. Chat can answer supported questions, navigate to existing screens, and prepare explicit-confirmation drafts for supported financial entries. The app has no per-user role model, so the assistant does not claim role-based data isolation and never reads credentials or secret settings.

## Known environment limitations

The frontend tests/build, backend tests, Capacitor sync, and Android debug APK build have been validated. No Android emulator/device or Oracle connection credentials were available, so native launch/SQLite runtime, Flyway execution against Oracle, and live upload/download or multi-device recovery remain unverified. No HTTPS API base URL or Oracle connection settings are configured in this workspace.

## Current implementation boundaries

The device repository stores one JSON payload per record in SQLite or IndexedDB and applies relationship and financial checks in the application service. Android sync tokens use Android Keystore-backed encryption; the SQLite database itself currently uses the plugin's no-encryption mode. The Oracle migration also defines normalized business tables, but the sync service currently persists cloud changes to the versioned `sync_records` envelope and does not project them into those tables. The API provides authenticated synchronization endpoints, not separate CRUD or report endpoints. The frontend is wired to bearer-token/device APIs, binds its local database to one business account, and triggers sync on app foreground, local changes, and connectivity restoration. It does not schedule work while the app process is stopped. Cloud backup snapshot export/import is not implemented; sync must not be used as a destructive restore path. The assistant supports local queries and navigation for existing business modules; notifications and activity-log queries remain unavailable because there is no corresponding local repository or audit-read API. Supplier-level purchase analysis is also unavailable because purchase records do not store supplier details.
