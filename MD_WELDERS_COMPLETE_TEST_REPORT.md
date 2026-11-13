# MD WELDERS — Complete Application Test Report

**QA date:** 2026-11-07
**Scope:** Workspace source/configuration review, frontend business tests, backend tests, live browser workflows, production build, Capacitor sync, and Android debug APK build.

## Executive summary

The application builds successfully for the web and Android. All 13 frontend tests, all 4 backend tests, and 69 live-browser checks passed. The browser checks covered navigation across all 12 screens, all 15 form entry points, employee photo and record workflows, customer/material workflows, assistant text drafts, report-period selectors, export/print actions, and offline/sync status behavior.

Testing also found and fixed six defects: broken form aliases, work-order edits that created another order, the employee active/inactive filter using the wrong table column, an unfiltered income table in date-range reports, a missing employee location field, and a missing AndroidX AppCompat dependency that prevented Android compilation.

**Overall release status: PARTIAL.** Build and tested browser/business paths pass, but production readiness is blocked by unimplemented local authentication, unencrypted native storage, unavailable Oracle/cloud configuration, lack of an Android device/emulator for runtime testing, and several incomplete transaction-management/reporting features listed below.

## Project and feature inventory

### Application screens

| Screen | Implemented surface inspected |
|---|---|
| Dashboard | Income/profit and work metrics, chart, quick actions, new work order |
| Employees | Add/search/filter, details, edit, confirmed delete, photo upload, salary display |
| Work | Create/search/edit work orders, team assignment and date availability |
| Salary | Employee balances, salary payment form, recent payment history |
| Materials | Material CRUD, purchase/usage forms, stock balance and movement history |
| Customers | Customer CRUD, search, history/details and bill/payment balances |
| Income | Bills, received payments, bill payment action, expense entry/history |
| Income detector | Today/month/year/custom ranges, profit/expenses/received/pending summaries |
| Assistant | Text, language selection, speech input, read-aloud, editable draft, confirm/discard |
| Reports | Period filters, income/expense summaries, salary/work/stock/customer tables, CSV/PDF actions |
| Backup | Local JSON backup download and file-based restore validation |
| Settings | Connectivity/sync status, sync action, conflict resolution, backup link, security notes |

### Navigation, actions, and persistence

- Shared sidebar navigation and mobile-menu control; all 12 routes were opened.
- Form actions were inventoried from the dashboard, module headings, inventory, payroll, income, and related record actions.
- Local entities are `employees`, `customers`, `workOrders`, `assignments`, `salaryPayments`, `materials`, `stockTransactions`, `bills`, `customerPayments`, `expenses`, `aiProposals`, and `settings`. The local repository also maintains a sync outbox.
- Browser persistence uses IndexedDB. Android is configured for Capacitor SQLite. Oracle migrations define relational business tables and the JSON sync envelope.
- Backend surfaces are authenticated `POST /api/v1/sync/batch`, `GET /api/v1/sync/changes`, and unauthenticated health/info endpoints.
- The project has no application login/registration UI. Sync authentication is a configured HTTP Basic administrator; it is not local-device authentication.

### Forms and important controls inventoried

Employee, customer, material, work-order, salary-payment, customer-payment, bill, expense, material-purchase, and material-usage forms; search inputs and employee status filter; customer/employee detail dialogs; delete confirmations; assistant draft fields and confirmation; report period/date controls; backup/restore file input; CSV/PDF and backup export; sync and conflict-resolution actions.

## Final test report

The module totals below are feature coverage groupings; a cross-cutting workflow can contribute evidence to more than one module, so these rows are not additive. The exact executed suite totals are shown after the table.

| Module | Total Tests | Passed | Failed | Status |
|---|---:|---:|---:|---|
| Authentication | 0 | 0 | 0 | **NOT IMPLEMENTED** — no local login/registration flow to exercise |
| Employee Management | 16 | 16 | 0 | **PASS** — add/list/reload, search/filter, edit/details, duplicate validation, delete, photo |
| Financial Management | 15 | 15 | 0 | **PASS / PARTIAL SCOPE** — business/calculation and period-selector checks pass; transaction-history CRUD gaps remain |
| AI Assistant | 10 | 10 | 0 | **PASS / PARTIAL SCOPE** — English, Tamil, Tanglish text drafts and confirmation guard pass; live speech capture blocked |
| Database | 2 | 2 | 0 | **PARTIAL** — browser IndexedDB/business persistence tested; Android SQLite and Oracle runtime are unverified |
| Offline Functionality | 2 | 2 | 0 | **PARTIAL** — IndexedDB workflow and offline status tested; native offline/restart behavior is unverified |
| Cloud Sync | 5 | 5 | 0 | **PARTIAL** — mocked service and local conflict logic pass; live Oracle/API sync is blocked by missing configuration |
| UI/UX | 30 | 30 | 0 | **PARTIAL** — screen, form-route, CSV/print actions pass at desktop viewport; mobile viewport and dark theme are unverified/not implemented |
| Security | 0 | 0 | 0 | **NOT CERTIFIED** — source/configuration inspection only; no configured auth environment or security test harness |

### Exact executed checks

| Test group | Executed | Passed | Failed |
|---|---:|---:|---:|
| Frontend Node test runner | 13 | 13 | 0 |
| Backend Maven/JUnit | 4 | 4 | 0 |
| Live-browser checks | 69 | 69 | 0 |
| **Total test cases/checks** | **86** | **86** | **0** |

The 69 live-browser checks comprised:

- 12/12 screens opened and rendered a non-empty screen heading.
- 15/15 Add/Create/Purchase/Usage/Payment/Expense/Bill form routes opened the expected form and could be cancelled.
- 16 employee checks covering add/save/list/reload, active filter, search and empty state, edit/details, duplicate phone rejection, required/optional fields, cancel, and profile-photo processing/display/deletion.
- 8 customer/material UI checks covering required validation, create/update/details/delete paths.
- 5 assistant UI checks covering English, Tanglish, Tamil, unclear input, and dismissal of the explicit-save confirmation.
- 8 income-detector/report period checks across Today, month, year, and custom ranges.
- 3 export/print action checks. CSV and backup download filenames were observed through an in-page download hook; the print action invoked the print request.
- 2 offline/settings checks: offline status displayed, and sync without an endpoint returned the expected configuration error.

### Automated test coverage

- Frontend tests cover assistant phrase parsing and no-save draft behavior, IndexedDB business workflow, employee validation/persistence/update/delete, work-assignment collision prevention, salary balance/overpayment protection, stock purchase/usage, customer bills/payments, expense/profit calculations, sync outbox/conflict handling, and invalid backup rejection.
- The controlled financial workflow independently asserted received income **₹40**, expenses **₹190**, profit **−₹150**, pending customer payments **₹60**, and period inclusion/exclusion. Calculation tests cover rounding, unpaid bills excluded from received income, salary balances, overpayment checks, and stock arithmetic.
- Backend JUnit tests cover new sync application, idempotent replay, version conflicts, and payload record-ID validation. JDBC is mocked; this does not verify Oracle behavior.
- No production database records were used in automated tests. Browser test data was created with QA-specific names, soft-deleted, then only those four known unsynced test records and their outbox entries were removed by exact ID. Existing active records were left unchanged, and the sync queue returned to its pre-test count.

## Build, integration, and launch results

| Check | Result | Evidence/limitation |
|---|---|---|
| Frontend tests | **PASS** | `npm test`: 13/13 |
| Production frontend build | **PASS** | `npm run build` |
| Capacitor Android sync | **PASS** | `npm run android:sync`; SQLite plugin detected |
| Backend compile/tests | **PASS** | Maven/JDK 25; 4/4 tests |
| Android debug APK | **PASS** | Gradle 8.11.1/JDK 21; `android/app/build/outputs/apk/debug/app-debug.apk` generated |
| Android launch/UI test | **BLOCKED** | `adb devices` returned no attached device; no AVD is configured |
| Android SQLite runtime/migration test | **BLOCKED** | APK build is not a native database execution test |
| Oracle Flyway migration | **BLOCKED** | Oracle URL/username/password are not configured |
| Live API/auth/sync | **BLOCKED** | API URL and administrator credentials are not configured; UI correctly reports sync is not configured |
| Mobile responsive visual test | **BLOCKED** | Browser automation ignored the requested 390px viewport and reported 1195px; CSS breakpoints were inspected but not visually certified |
| Voice recognition | **BLOCKED** | Browser exposed SpeechRecognition but produced “Could not recognize speech”; no usable microphone/audio input was available |
| Backup file download/restore UI | **PARTIAL** | Export action and filename were observed; browser download event/file inspection was unavailable. Invalid-version rejection is covered by the business test, not a real-file restore on Android |

The first Android build attempt used JDK 25 with Gradle 8.11.1 and failed because that Gradle version cannot run on that JDK. Retrying with JDK 21 exposed the missing AppCompat dependency; after adding it, the Android APK build succeeded. Build warnings about legacy Java 8 source/target in a dependency and SDK XML-version differences did not prevent the final build.

## Bugs discovered and fixed

1. **Form-route mismatches:** singular/hyphenated actions such as `form-work`, `form-material`, `form-customer`, `form-customer-payment`, and `form-salary-payment` did not match the form switch. Added a shared alias map; all 15 form entry points now open their expected forms.
2. **Work-order edit duplicated records:** the edit form called the create function. Editing now uses `updateRecord`; customer and location are optional, and the status choices include cancellation.
3. **Employee status filter used an obsolete table column index:** adding Job Role shifted the status column. The filter now reads the status cell at index 6.
4. **Employee location was not editable in the form:** added the optional location field.
5. **Date-filtered reports showed out-of-period income rows:** the “Income received” report table now filters by the selected inclusive date range.
6. **Android compilation failed:** added the AppCompat dependency required by Capacitor’s `BridgeActivity`.

All automated suites, production build, Capacitor sync, and Android APK build were rerun after the fixes.

## Remaining bugs and actionable work

### Release-blocking

1. **Add local authentication and authorization.** There is no login/registration or local session protection. Implement a deliberate offline-capable authentication design and appropriate roles before storing real business data on shared/lost devices.
2. **Protect local business data at rest.** Android SQLite currently uses the plugin’s `no-encryption` mode. Define secure key storage and encryption, plus a migration/backup strategy, before production.
3. **Configure and integration-test Oracle/cloud sync.** Supply Oracle and admin secrets outside source control, run Flyway against a disposable Oracle test database, then test authenticated batch sync, retries, pagination, duplicate idempotency, conflicts, and failed-network recovery. Current backend tests use mocked JDBC.
4. **Run Android on a real device/emulator.** Verify startup, SQLite schema upgrades, offline creation/reopen, keyboard behavior, permissions, backup/restore, and speech recognition. The APK build alone does not establish runtime correctness.

### Functional completeness

5. **Add edit/delete controls for financial history.** Received customer payments, salary payments, and expenses are displayed as read-only history. Provide safe correction/reversal workflows with balance/idempotency checks and audit history rather than silently rewriting financial records.
6. **Support work-team edits after order creation.** The current order editor updates order fields/status/date, but does not add/remove/reassign employees. Define salary/history behavior before enabling assignment changes.
7. **Apply report date ranges consistently.** Received-income rows and summary calculations now respect the selected range, but employee salary, work-order, customer-balance, and stock panels are lifetime/current summaries. Either filter historical panels or label them explicitly as current/all-time snapshots.
8. **Complete the assistant’s promised scope.** It is a limited local phrase parser, not a configured AI service. Validate Tamil/Tanglish variants against an agreed phrase set; voice capture and playback require device-level testing. Preserve the explicit confirmation gate.
9. **Add a dark theme or explicitly remove that requirement.** No theme toggle or dark palette is implemented.
10. **Align cloud schema constraints with application validation.** The Oracle V1 employee salary constraint permits zero while the application requires salary greater than zero. Review legacy data and add a safe migration/constraint policy.
11. **Add and validate the Gradle wrapper.** The Android build currently relies on a locally available Gradle distribution; wrapper files are absent, reducing reproducibility for other developers/CI.
12. **Test actual downloadable output.** Browser QA verified export actions and intended filenames, but did not inspect saved CSV/JSON bytes or a produced PDF. Add automated download-content tests and restore a valid backup only in an isolated test database.

## Files changed during this QA pass

- `frontend/src/main.js` — form aliases, work-order edit behavior, employee location/filter, and date-filtered income report rows.
- `tests/business.test.js` — successful work-order edit and month/year/empty-range regressions.
- `android/app/build.gradle` — AppCompat dependency for Android compilation.
- `README.md` — corrected stale build/environment status.
- `documentation/architecture.md` — corrected validation/environment limitations.
- `MD_WELDERS_COMPLETE_TEST_REPORT.md` — this report.
