# Directory module coverage ledger — GitHub-only engineering audit

> Inside non-runtime engineering documentation: `docs/engineering/MODULE_COVERAGE_LEDGER.md`. Linked to [FILE_COVERAGE_LEDGER.md](FILE_COVERAGE_LEDGER.md) (every tracked path) and [SYSTEM_UNIFICATION_NOTEBOOK.md](SYSTEM_UNIFICATION_NOTEBOOK.md) (root causes, decisions, tests).
> Tree snapshot: `main@9854d7aee4a4e9fbcfcd409e8c9db4bb83ab1eab`; 1901 tracked files; 268 directory modules including parents; GitHub tree response `truncated=false`.
> IMPORTANT: directory entry `TODO` means only the inventory/path was checked, **not** a line-by-line audit. Do not mark DONE unless the source and interfaces were reviewed and current-SHA tests actually ran. No claim of fully tested or error-free production.

## State and observed root causes

| ID | State | Cause / authoritative contract | Fix and evidence |
|---|---|---|---|
| BILL-TEST-001 | FIX PRESENT; CI pending | Blocked subscription fixture had null end, but runtime rejects invalid active contract first | `36114a887` finite expiry in fixture, never relax live predicate |
| BILL-CYCLE-001 | FIX PRESENT; staging BLOCKED | Historical 0101 30-day cycles contradicted UTC calendar month policy | `5abd6458` + immutable 0102 carry migration; `fb0ca395` monthly history; populated restore NOT RUN |
| BILL-STATUS-001 | FIX PRESENT; CI pending | Admin displayed stored status vs live runtime contract | `8b677ba`, `54b07b` shared predicate and status projection |
| AUTH-INV-001 | FIX PRESENT; CI pending | Platform Owner confused with Workspace Owner invite authority | `972d7df`: verified role=owner; Full Access cannot invite |
| I18N-QUOTA-001 | FIX PRESENT; CI pending | Quota exhaustion conflated with expired contract, Odoo rolling copy | `22457a3` ar/en error code; Odoo monthly copy |
| PRINTER-ALIAS-001 | IN PROGRESS; Go/TS CI pending | Gateway local ID 120 bytes grew to 129 on alias; Go stripped any 8-hex suffix and could resolve wrong backend | Bounded UTF-8 aliases + native SHA256/agent-scope validation and regression in current change batch |
| HW-PRINT-001 | BLOCKED | No real Windows spooler, printer, production database or staging credentials used | Run authorized release acceptance with physical print evidence |
| SEC-IMAGE-001 | TODO | Historic Brotli CVE image remediation pinned; current image scan not yet independently reviewed | Verify exact image digest, scan results and expiring baseline |

## Module inventory

Each directory below has an **explicit state**; direct file counts exclude nested files. The existing file ledger indexes all individual files under each directory. `TODO` never implies a verified bug or passing test; it means trace all inbound/outbound contracts, test, then mark DONE. `BLOCKED` is used for owned-external vendor artifacts; physical/staging limitations are listed above.

### CI

| State | Module directory | Direct files | Responsibility | Shared contract | Inconsistency / limit | Required fix / verification |
|---|---|---:|---|---|---|---|
| TODO | `.github` | 2 | CI, images, Windows build and supply-chain gates | CI action/job outcome + pinned artifacts | Potential changed-path skips; red != green | Check exact SHA and every required job |
| TODO | `.github/workflows` | 6 | CI, images, Windows build and supply-chain gates | CI action/job outcome + pinned artifacts | Potential changed-path skips; red != green | Check exact SHA and every required job |

### root

| State | Module directory | Direct files | Responsibility | Shared contract | Inconsistency / limit | Required fix / verification |
|---|---|---:|---|---|---|---|
| TODO | `(root)` | 46 | Project orchestration, API/docs and build configuration | Release gates and migration journal | Historical fixed-30-day quota and server trust documented | See 0102 calendar-month fix; review configuration parity |

### Go Agent

| State | Module directory | Direct files | Responsibility | Shared contract | Inconsistency / limit | Required fix / verification |
|---|---|---:|---|---|---|---|
| TODO | `agent` | 3 | Agent configuration, payload parsing, integration | Gateway origin, printing contracts | Partial file inspection only | Verify Go race, integration and Windows behaviors |
| TODO | `agent/cmd` | 0 | Agent service/CLI bootstrap, pairing and cleanup | Server origin, credentials, windows service owner | Unknown until CLI/SCM gates reviewed | Cross-check Gateway and Rust control commands |
| TODO | `agent/cmd/agent` | 10 | Agent service/CLI bootstrap, pairing and cleanup | Server origin, credentials, windows service owner | Unknown until CLI/SCM gates reviewed | Cross-check Gateway and Rust control commands |
| TODO | `agent/cmd/cli` | 17 | Agent service/CLI bootstrap, pairing and cleanup | Server origin, credentials, windows service owner | Unknown until CLI/SCM gates reviewed | Cross-check Gateway and Rust control commands |
| TODO | `agent/configs` | 1 | Agent configuration, payload parsing, integration | Gateway origin, printing contracts | Partial file inspection only | Verify Go race, integration and Windows behaviors |
| TODO | `agent/internal` | 0 | Agent configuration, payload parsing, integration | Gateway origin, printing contracts | Partial file inspection only | Verify Go race, integration and Windows behaviors |
| TODO | `agent/internal/agent` | 63 | Agent heartbeat, local queue, claim fences, WS reconnection | Gateway heartbeat job API, printer alias contract | Aliased ID may exceed 120 bytes; unverified hash suffix previously stripped | Bound aliases; validate digest on Agent; test Go + TS |
| TODO | `agent/internal/config` | 19 | Agent configuration, payload parsing, integration | Gateway origin, printing contracts | Partial file inspection only | Verify Go race, integration and Windows behaviors |
| TODO | `agent/internal/integration` | 3 | Agent configuration, payload parsing, integration | Gateway origin, printing contracts | Partial file inspection only | Verify Go race, integration and Windows behaviors |
| TODO | `agent/internal/payload` | 3 | Agent configuration, payload parsing, integration | Gateway origin, printing contracts | Partial file inspection only | Verify Go race, integration and Windows behaviors |
| TODO | `agent/internal/printer` | 217 | Transport execution, discovery, spooler/IPP/USB, geometry and proof | contracts/print-payload and printer-geometry | Real printer not verified; proof cannot be inferred | Review transport-specific failures; hardware gate BLOCKED |
| TODO | `agent/internal/printer/testdata` | 3 | Transport execution, discovery, spooler/IPP/USB, geometry and proof | contracts/print-payload and printer-geometry | Real printer not verified; proof cannot be inferred | Review transport-specific failures; hardware gate BLOCKED |
| TODO | `agent/internal/queue` | 8 | Durable local attempts, spool and recovery | Claim token, terminal receipts, unknown-outcome markers | No physical crash/restart proof in this review | Run failure injection, never blindly reprint |
| TODO | `agent/internal/storage` | 10 | Durable local attempts, spool and recovery | Claim token, terminal receipts, unknown-outcome markers | No physical crash/restart proof in this review | Run failure injection, never blindly reprint |
| TODO | `agent/internal/testutil` | 2 | Agent configuration, payload parsing, integration | Gateway origin, printing contracts | Partial file inspection only | Verify Go race, integration and Windows behaviors |

### Contracts

| State | Module directory | Direct files | Responsibility | Shared contract | Inconsistency / limit | Required fix / verification |
|---|---|---:|---|---|---|---|
| TODO | `contracts` | 8 | Versioned cross-component JSON contracts and fixtures | Payload, geometry, printer sharing, native IPC | Contract files alone do not prove implementation | Compare consumers per contract and add tests |

### Documentation

| State | Module directory | Direct files | Responsibility | Shared contract | Inconsistency / limit | Required fix / verification |
|---|---|---:|---|---|---|---|
| TODO | `docs` | 19 | Engineering docs, release and acceptance procedures | Architecture contracts and coverage ledger | Some docs historical; runtime wording drift risk | Keep evidence-scoped, verify dates and versions |
| TODO | `docs/acceptance` | 2 | Engineering docs, release and acceptance procedures | Architecture contracts and coverage ledger | Some docs historical; runtime wording drift risk | Keep evidence-scoped, verify dates and versions |
| TODO | `docs/engineering` | 3 | Engineering docs, release and acceptance procedures | Architecture contracts and coverage ledger | Some docs historical; runtime wording drift risk | Keep evidence-scoped, verify dates and versions |
| TODO | `docs/runtime-hardening` | 13 | Engineering docs, release and acceptance procedures | Architecture contracts and coverage ledger | Some docs historical; runtime wording drift risk | Keep evidence-scoped, verify dates and versions |
| TODO | `docs/runtime-hardening/caddy` | 3 | Engineering docs, release and acceptance procedures | Architecture contracts and coverage ledger | Some docs historical; runtime wording drift risk | Keep evidence-scoped, verify dates and versions |
| TODO | `docs/runtime-hardening/gosu` | 3 | Engineering docs, release and acceptance procedures | Architecture contracts and coverage ledger | Some docs historical; runtime wording drift risk | Keep evidence-scoped, verify dates and versions |
| TODO | `docs/superpowers` | 0 | Engineering docs, release and acceptance procedures | Architecture contracts and coverage ledger | Some docs historical; runtime wording drift risk | Keep evidence-scoped, verify dates and versions |
| TODO | `docs/superpowers/plans` | 1 | Engineering docs, release and acceptance procedures | Architecture contracts and coverage ledger | Some docs historical; runtime wording drift risk | Keep evidence-scoped, verify dates and versions |

### PostgreSQL

| State | Module directory | Direct files | Responsibility | Shared contract | Inconsistency / limit | Required fix / verification |
|---|---|---:|---|---|---|---|
| TODO | `drizzle` | 103 | Schema, immutable forward-only SQL and upgrade state | Drizzle journal, tenant isolation and usage ledger | 0102 data migration requires populated staging restore rehearsal | Never rewrite applied SQL; run migration upgrade test |
| TODO | `drizzle/meta` | 35 | Schema, immutable forward-only SQL and upgrade state | Drizzle journal, tenant isolation and usage ledger | 0102 data migration requires populated staging restore rehearsal | Never rewrite applied SQL; run migration upgrade test |

### Odoo

| State | Module directory | Direct files | Responsibility | Shared contract | Inconsistency / limit | Required fix / verification |
|---|---|---:|---|---|---|---|
| TODO | `odoo_addons` | 0 | Odoo addon repository subtree | Odoo model ↔ Gateway boundaries | Installed Odoo module requires native DB/harness verification | Run exact hardened-image suite |
| TODO | `odoo_addons/print_gateway` | 10 | Odoo module install, controllers, data, tests and views | Company-scoped ERP bindings ↔ Gateway printer IDs | Odoo runtime/driver test evidence pending | Full Odoo tests including POS/report and company isolation |
| TODO | `odoo_addons/print_gateway/controllers` | 3 | Odoo module install, controllers, data, tests and views | Company-scoped ERP bindings ↔ Gateway printer IDs | Odoo runtime/driver test evidence pending | Full Odoo tests including POS/report and company isolation |
| TODO | `odoo_addons/print_gateway/data` | 1 | Odoo module install, controllers, data, tests and views | Company-scoped ERP bindings ↔ Gateway printer IDs | Odoo runtime/driver test evidence pending | Full Odoo tests including POS/report and company isolation |
| TODO | `odoo_addons/print_gateway/i18n` | 1 | Odoo module install, controllers, data, tests and views | Company-scoped ERP bindings ↔ Gateway printer IDs | Odoo runtime/driver test evidence pending | Full Odoo tests including POS/report and company isolation |
| TODO | `odoo_addons/print_gateway/migrations` | 1 | Odoo addon forward schema/data migrations | Odoo ORM, installation identity | Historical migrations must be immutable | Test fresh and populated upgrade under Odoo |
| TODO | `odoo_addons/print_gateway/migrations/1.1.0` | 2 | Odoo addon forward schema/data migrations | Odoo ORM, installation identity | Historical migrations must be immutable | Test fresh and populated upgrade under Odoo |
| TODO | `odoo_addons/print_gateway/migrations/19.0.1.1.0` | 2 | Odoo addon forward schema/data migrations | Odoo ORM, installation identity | Historical migrations must be immutable | Test fresh and populated upgrade under Odoo |
| TODO | `odoo_addons/print_gateway/migrations/19.0.2.1.0` | 2 | Odoo addon forward schema/data migrations | Odoo ORM, installation identity | Historical migrations must be immutable | Test fresh and populated upgrade under Odoo |
| TODO | `odoo_addons/print_gateway/migrations/19.0.2.10.0` | 2 | Odoo addon forward schema/data migrations | Odoo ORM, installation identity | Historical migrations must be immutable | Test fresh and populated upgrade under Odoo |
| TODO | `odoo_addons/print_gateway/migrations/19.0.2.14.0` | 1 | Odoo addon forward schema/data migrations | Odoo ORM, installation identity | Historical migrations must be immutable | Test fresh and populated upgrade under Odoo |
| TODO | `odoo_addons/print_gateway/migrations/19.0.2.21.0` | 1 | Odoo addon forward schema/data migrations | Odoo ORM, installation identity | Historical migrations must be immutable | Test fresh and populated upgrade under Odoo |
| TODO | `odoo_addons/print_gateway/migrations/19.0.2.29.0` | 1 | Odoo addon forward schema/data migrations | Odoo ORM, installation identity | Historical migrations must be immutable | Test fresh and populated upgrade under Odoo |
| TODO | `odoo_addons/print_gateway/migrations/19.0.2.3.0` | 2 | Odoo addon forward schema/data migrations | Odoo ORM, installation identity | Historical migrations must be immutable | Test fresh and populated upgrade under Odoo |
| TODO | `odoo_addons/print_gateway/migrations/19.0.2.30.0` | 1 | Odoo addon forward schema/data migrations | Odoo ORM, installation identity | Historical migrations must be immutable | Test fresh and populated upgrade under Odoo |
| TODO | `odoo_addons/print_gateway/migrations/19.0.2.4.0` | 2 | Odoo addon forward schema/data migrations | Odoo ORM, installation identity | Historical migrations must be immutable | Test fresh and populated upgrade under Odoo |
| TODO | `odoo_addons/print_gateway/migrations/19.0.2.6.0` | 2 | Odoo addon forward schema/data migrations | Odoo ORM, installation identity | Historical migrations must be immutable | Test fresh and populated upgrade under Odoo |
| TODO | `odoo_addons/print_gateway/migrations/19.0.2.7.0` | 2 | Odoo addon forward schema/data migrations | Odoo ORM, installation identity | Historical migrations must be immutable | Test fresh and populated upgrade under Odoo |
| TODO | `odoo_addons/print_gateway/migrations/19.0.2.8.0` | 2 | Odoo addon forward schema/data migrations | Odoo ORM, installation identity | Historical migrations must be immutable | Test fresh and populated upgrade under Odoo |
| TODO | `odoo_addons/print_gateway/models` | 16 | Odoo reports/receipts, durable outbox, company scope | Gateway errors, V2 idempotency, print statuses | Potential stale work after billing denial needs explicit-reprint policy | Run Odoo model and contract tests |
| TODO | `odoo_addons/print_gateway/security` | 2 | Odoo module install, controllers, data, tests and views | Company-scoped ERP bindings ↔ Gateway printer IDs | Odoo runtime/driver test evidence pending | Full Odoo tests including POS/report and company isolation |
| TODO | `odoo_addons/print_gateway/static` | 0 | POS/report and frontend JS user flows | Gateway admission, POS retry and language rules | No real Odoo UI screenshots or printer output | Run Odoo addon/browser/e2e; no surprise replay |
| TODO | `odoo_addons/print_gateway/static/description` | 1 | POS/report and frontend JS user flows | Gateway admission, POS retry and language rules | No real Odoo UI screenshots or printer output | Run Odoo addon/browser/e2e; no surprise replay |
| TODO | `odoo_addons/print_gateway/static/fonts` | 6 | POS/report and frontend JS user flows | Gateway admission, POS retry and language rules | No real Odoo UI screenshots or printer output | Run Odoo addon/browser/e2e; no surprise replay |
| TODO | `odoo_addons/print_gateway/static/src` | 0 | POS/report and frontend JS user flows | Gateway admission, POS retry and language rules | No real Odoo UI screenshots or printer output | Run Odoo addon/browser/e2e; no surprise replay |
| TODO | `odoo_addons/print_gateway/static/src/components` | 4 | POS/report and frontend JS user flows | Gateway admission, POS retry and language rules | No real Odoo UI screenshots or printer output | Run Odoo addon/browser/e2e; no surprise replay |
| TODO | `odoo_addons/print_gateway/static/src/css` | 3 | POS/report and frontend JS user flows | Gateway admission, POS retry and language rules | No real Odoo UI screenshots or printer output | Run Odoo addon/browser/e2e; no surprise replay |
| TODO | `odoo_addons/print_gateway/static/src/js` | 10 | POS/report and frontend JS user flows | Gateway admission, POS retry and language rules | No real Odoo UI screenshots or printer output | Run Odoo addon/browser/e2e; no surprise replay |
| TODO | `odoo_addons/print_gateway/static/src/js/tours` | 1 | POS/report and frontend JS user flows | Gateway admission, POS retry and language rules | No real Odoo UI screenshots or printer output | Run Odoo addon/browser/e2e; no surprise replay |
| TODO | `odoo_addons/print_gateway/static/src/scss` | 2 | POS/report and frontend JS user flows | Gateway admission, POS retry and language rules | No real Odoo UI screenshots or printer output | Run Odoo addon/browser/e2e; no surprise replay |
| TODO | `odoo_addons/print_gateway/tests` | 15 | Odoo module install, controllers, data, tests and views | Company-scoped ERP bindings ↔ Gateway printer IDs | Odoo runtime/driver test evidence pending | Full Odoo tests including POS/report and company isolation |
| TODO | `odoo_addons/print_gateway/views` | 7 | Odoo module install, controllers, data, tests and views | Company-scoped ERP bindings ↔ Gateway printer IDs | Odoo runtime/driver test evidence pending | Full Odoo tests including POS/report and company isolation |

### Tooling

| State | Module directory | Direct files | Responsibility | Shared contract | Inconsistency / limit | Required fix / verification |
|---|---|---:|---|---|---|---|
| TODO | `scripts` | 41 | CI/deployment tooling, acceptance and migrator | Safe migration, production release, URL/tenant gate | No production/staging access in this session | Run on isolated CI/staging; never deploy |
| TODO | `scripts/acceptance` | 23 | CI/deployment tooling, acceptance and migrator | Safe migration, production release, URL/tenant gate | No production/staging access in this session | Run on isolated CI/staging; never deploy |
| TODO | `scripts/lint` | 1 | CI/deployment tooling, acceptance and migrator | Safe migration, production release, URL/tenant gate | No production/staging access in this session | Run on isolated CI/staging; never deploy |

### Security

| State | Module directory | Direct files | Responsibility | Shared contract | Inconsistency / limit | Required fix / verification |
|---|---|---:|---|---|---|---|
| TODO | `security` | 7 | Image/permission/security baselines | Trivy, pinned images and expiration policy | Pending artifact CVE review | Verify scans on exact tested images |

### Gateway and Desktop

| State | Module directory | Direct files | Responsibility | Shared contract | Inconsistency / limit | Required fix / verification |
|---|---|---:|---|---|---|---|
| TODO | `src` | 0 | Shared Next.js runtime, styles and components | UI ↔ Gateway API ↔ DB | Not all page routes manually inspected | Run full Next build/visual regression |
| TODO | `src/app` | 8 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/api` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api-keys` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/admin` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/admin/tenants` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/admin/tenants/[id]` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/admin/tenants/[id]/lifecycle` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agent` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agent/desired-state` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agent/discovery` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agent/heartbeat` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agent/jobs` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agent/probe` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agent/register` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agents` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agents/[id]` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agents/[id]/discovered-printers` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agents/[id]/discovered-printers/[deviceId]` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agents/[id]/discovered-printers/[deviceId]/provision` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agents/[id]/discovered-printers/[deviceId]/verify` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agents/[id]/discovery` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agents/[id]/discovery/[discoveryId]` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agents/[id]/discovery/[discoveryId]/cancel` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agents/health` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/agents/service-status` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/activity` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/forgot-password` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/login` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/logout` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/manager` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/manager/login` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/manager/logout` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/manager/me` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/manager/refresh` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/me` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/reauth` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/reauth/password` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/reauth/status` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/refresh` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/register` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/resend-verification` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/reset-password` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/select-tenant` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/sessions` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/auth/verify-email` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/billing` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/billing/cancel` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/billing/checkout` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/billing/plans` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/billing/portal` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/billing/resume` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/billing/status` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/billing/usage` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/billing/webhook` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/health` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/jobs` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/jobs/[id]` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/jobs/[id]/reprint` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/jobs/[id]/timeline` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/live` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/metrics` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/odoo` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/odoo/agents` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/odoo/configuration` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/odoo/health` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/odoo/installations` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/odoo/installations/auto` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/odoo/installations/cutover` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/odoo/installations/resolutions` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/odoo/keys` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/odoo/keys/[id]` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/odoo/keys/[id]/rotate` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/odoo/printers` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/onboarding` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/audit` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/auth` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/auth/login` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/auth/logout` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/auth/me` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/auth/reauth` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/auth/refresh` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/auth/sessions` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/database` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/fleet` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/fleet/delete` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/fleet/lifecycle` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/integrations` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/integrations/quarantine` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/integrations/remove` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/integrations/revoke` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/jobs` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/plans` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/plans/[id]` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/stats` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/subscription-requests` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/subscriptions` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/tenants` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/tenants/[id]` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/tenants/[id]/delete` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/tenants/[id]/invitations` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/tenants/[id]/members` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/tenants/[id]/ownership` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/tenants/[id]/reactivate` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/tenants/[id]/subscription` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/platform/tenants/[id]/suspend` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/print` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/print/jobs` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/print/jobs/batch-status` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/print/jobs/v2` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/printers` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/printers/[id]` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/printers/[id]/certify` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/printers/[id]/test-connection` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/printers/[id]/test-print` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/printers/capabilities` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/security` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/security/csp-report` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/settings` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/subscription-requests` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/team` | 0 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/team/invitations` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/team/invitations/accept` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/team/invitations/preview` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/team/members` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/api/team/ownership` | 1 | Tenant-scoped Gateway API handlers | Typed errors, transaction fences, idempotency | Authorization/tenant matrix not exhausted | Trace request to DB, add negative-tenant regressions |
| TODO | `src/app/billing` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/dashboard` | 2 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/fonts` | 11 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/forgot-password` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/invite` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/login` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/onboarding` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform` | 2 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/audit` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/dashboard` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/database` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/fleet` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/integrations` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/jobs` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/login` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/operations` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/plans` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/release-readiness` | 2 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/security` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/subscription-requests` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/subscriptions` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/tenants` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/platform/tenants/[id]` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/pricing` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/reset-password` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/settings` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/signup` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/team` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/app/verify-email` | 1 | Next.js customer, owner and platform UIs | Subscriptions, team roles, EN/AR/RTL | Billing and owner invites recently reconciled; incomplete UI QA | Run role/locale/browser E2E |
| TODO | `src/components` | 20 | Shared Next.js runtime, styles and components | UI ↔ Gateway API ↔ DB | Not all page routes manually inspected | Run full Next build/visual regression |
| TODO | `src/components/marketing` | 3 | Shared Next.js runtime, styles and components | UI ↔ Gateway API ↔ DB | Not all page routes manually inspected | Run full Next build/visual regression |
| TODO | `src/components/platform` | 4 | Shared Next.js runtime, styles and components | UI ↔ Gateway API ↔ DB | Not all page routes manually inspected | Run full Next build/visual regression |
| TODO | `src/db` | 3 | Schema, immutable forward-only SQL and upgrade state | Drizzle journal, tenant isolation and usage ledger | 0102 data migration requires populated staging restore rehearsal | Never rewrite applied SQL; run migration upgrade test |
| TODO | `src/desktop` | 7 | Desktop user flows and typed native IPC | Gateway Console contract, EN/AR, secure bridge | UI/native parity requires rendered screenshots | Review IPC and session tests, hardware BLOCKED |
| TODO | `src/desktop/components` | 7 | Desktop user flows and typed native IPC | Gateway Console contract, EN/AR, secure bridge | UI/native parity requires rendered screenshots | Review IPC and session tests, hardware BLOCKED |
| TODO | `src/desktop/lib` | 4 | Desktop user flows and typed native IPC | Gateway Console contract, EN/AR, secure bridge | UI/native parity requires rendered screenshots | Review IPC and session tests, hardware BLOCKED |
| TODO | `src/desktop/pages` | 4 | Desktop user flows and typed native IPC | Gateway Console contract, EN/AR, secure bridge | UI/native parity requires rendered screenshots | Review IPC and session tests, hardware BLOCKED |
| TODO | `src/desktop/preview` | 2 | Desktop user flows and typed native IPC | Gateway Console contract, EN/AR, secure bridge | UI/native parity requires rendered screenshots | Review IPC and session tests, hardware BLOCKED |
| TODO | `src/desktop/public` | 2 | Desktop user flows and typed native IPC | Gateway Console contract, EN/AR, secure bridge | UI/native parity requires rendered screenshots | Review IPC and session tests, hardware BLOCKED |
| TODO | `src/i18n` | 5 | Arabic/English locale catalogs and formatting | Error codes and status labels | Quota wording changed; Arabic RTL requires browser QA | Run catalogs + real AR/RTL snapshots |
| TODO | `src/i18n/messages` | 5 | Arabic/English locale catalogs and formatting | Error codes and status labels | Quota wording changed; Arabic RTL requires browser QA | Run catalogs + real AR/RTL snapshots |
| TODO | `src/lib` | 118 | Gateway domain logic, permissions, accounting, printer and job state | PostgreSQL + Odoo + Agent canonical contracts | Calendar quota and alias issues identified; others unassessed | Test per function and cross-layer interface |
| TODO | `src/server` | 9 | WebSocket, request guards and CORS/correlation | Agent authentication and claim fences | Live network/partition unverified | WebSocket fault injection and bounded-load tests |
| TODO | `src/shared` | 5 | Cross-surface status vocabulary and shared utilities | Gateway+Desktop physical outcome contract | Only source/machine gates available | Assert unknown/printed parity across stacks |

### Tauri

| State | Module directory | Direct files | Responsibility | Shared contract | Inconsistency / limit | Required fix / verification |
|---|---|---:|---|---|---|---|
| TODO | `src-tauri` | 6 | Tauri command bridge, native lifecycle and installer | Gateway Console contract; Agent CLI; local credentials | Windows service and physical printer unavailable here | Run native/Windows release evidence |
| TODO | `src-tauri/capabilities` | 1 | Tauri command bridge, native lifecycle and installer | Gateway Console contract; Agent CLI; local credentials | Windows service and physical printer unavailable here | Run native/Windows release evidence |
| TODO | `src-tauri/icons` | 10 | Tauri command bridge, native lifecycle and installer | Gateway Console contract; Agent CLI; local credentials | Windows service and physical printer unavailable here | Run native/Windows release evidence |
| TODO | `src-tauri/native-regressions` | 2 | Tauri command bridge, native lifecycle and installer | Gateway Console contract; Agent CLI; local credentials | Windows service and physical printer unavailable here | Run native/Windows release evidence |
| TODO | `src-tauri/native-regressions/src` | 1 | Tauri command bridge, native lifecycle and installer | Gateway Console contract; Agent CLI; local credentials | Windows service and physical printer unavailable here | Run native/Windows release evidence |
| TODO | `src-tauri/src` | 9 | Tauri command bridge, native lifecycle and installer | Gateway Console contract; Agent CLI; local credentials | Windows service and physical printer unavailable here | Run native/Windows release evidence |
| TODO | `src-tauri/tests` | 1 | Tauri command bridge, native lifecycle and installer | Gateway Console contract; Agent CLI; local credentials | Windows service and physical printer unavailable here | Run native/Windows release evidence |
| BLOCKED | `src-tauri/vendor` | 2 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/glib` | 8 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/glib-macros` | 5 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/glib-macros/src` | 15 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/glib-macros/src/downgrade_derive` | 4 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/glib-macros/tests` | 4 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/glib/benches` | 1 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/glib/src` | 53 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/glib/src/auto` | 16 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/glib/src/collections` | 6 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/glib/src/gobject` | 5 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/glib/src/gobject/auto` | 5 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/glib/src/subclass` | 9 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/glib/tests` | 8 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/glib/tests/subclass_compiletest` | 10 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/gtk3-macros` | 5 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/gtk3-macros/src` | 4 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |
| BLOCKED | `src-tauri/vendor/patches` | 2 | Pinned upstream third-party crates | Upstream provenance, checksums, supply chain | Not owned product source | External vendor review / security scan |

### Tests

| State | Module directory | Direct files | Responsibility | Shared contract | Inconsistency / limit | Required fix / verification |
|---|---|---:|---|---|---|---|
| TODO | `tests` | 556 | Cross-component unit/integration/static regressions | All runtime contracts + migration journal | Not every test executed on current HEAD | Require fresh CI and no skipped relevant suite |
| TODO | `tests/__mocks__` | 1 | Cross-component unit/integration/static regressions | All runtime contracts + migration journal | Not every test executed on current HEAD | Require fresh CI and no skipped relevant suite |
| TODO | `tests/fixtures` | 3 | Cross-component unit/integration/static regressions | All runtime contracts + migration journal | Not every test executed on current HEAD | Require fresh CI and no skipped relevant suite |
| TODO | `tests/helpers` | 11 | Cross-component unit/integration/static regressions | All runtime contracts + migration journal | Not every test executed on current HEAD | Require fresh CI and no skipped relevant suite |
| TODO | `tests/reporters` | 1 | Cross-component unit/integration/static regressions | All runtime contracts + migration journal | Not every test executed on current HEAD | Require fresh CI and no skipped relevant suite |

### Typography

| State | Module directory | Direct files | Responsibility | Shared contract | Inconsistency / limit | Required fix / verification |
|---|---|---:|---|---|---|---|
| TODO | `typography` | 1 | Repository support assets | Applicable parent-level contracts | File-level review not completed | Inspect files, owner and tests before DONE |

## Verification matrix (no pass without exact-SHA evidence)

| Verification | Status | Environment / command family |
|---|---|---|
| Gateway lint/typecheck/unit + PostgreSQL integration | NOT RUN in this note; GitHub Actions CI must be checked for exact commit | `App / Quality`, `App / Gateway` |
| Odoo business model/controller/POS/report | NOT RUN in this note | Hardened Odoo CI image and integration suite |
| Go Agent alias/queue/printer/Windows | NOT RUN in this note | `Agent / Go` on exact commit; Windows hardware additionally BLOCKED |
| Tauri native/installer | NOT RUN in this note | Windows installer + native backport checks |
| Docker image vulnerabilities, Trivy | NOT RUN in this note | `Docker`/Static Security exact image artifacts |
| UTC calendar quota 0102 on populated staging + restore | BLOCKED | Backup/restore rehearsal; no data resets |
| Actual paper printed in Windows/IPP/USB, network fault | BLOCKED | Authorized hardware and physical output evidence |

**Release signoff:** BLOCKED until every applicable workflow has completed for the same immutable SHA and the hardware, populated migration, and restore gates are explicitly recorded. Green parent workflow with skipped jobs is not execution. Do not auto-retry physically ambiguous outcomes.

## Audit progression

- Directory mapping DONE (inventory only); file-level correctness remains TODO for every not-reviewed path.
- The module table intentionally retains TODO; the no-TODO completion criterion has **not** been met. Never erase TODO to make a progress metric green.
- On each real source batch append exact commit SHA, changed paths, root-cause boundary, RED→GREEN regression evidence, CI run/job URLs, and newly discovered TODO/BLOCKED statuses here; update the existing notebook and ledger in parallel.


### 2026-10-28 Odoo report routing verification batch

| Module | State | Business logic | Cross-layer contract | Confirmed inconsistency | Fix and verification |
|---|---|---|---|---|---|
| `odoo_addons/print_gateway/static/src/js` | TODO (fix present) | Browser report interception and POS submission/recovery | Odoo `has_binding/dispatched/status` response, Gateway physical attempt, native PDF fallback | Contradictory no-binding response reopened native printing despite a possible Gateway submission | `097e6041` guards explicit no-dispatch; `tests/current-run-report.node.test.mjs` asserts fail-closed identity reuse; CI pending |
| `odoo_addons/print_gateway/i18n` | TODO (translation added) | Arabic customer errors | Odoo `_t` catalogue and active locale | New fail-closed notice would otherwise fall back to English | `ar.po` occurrence; full translation checker CI pending |
| `tests` | TODO (focused regression added) | Browser regression suite | Real registry callback using mocked RPC boundary | Earlier unbound test accepted incomplete response with no dispatch field | Updated good fixture and added six contradictory cases; exact run NOT RUN |


### 2026-10-28 Homepage authority + Odoo structured RPC follow-up

| Module | State | Logic | Shared contracts | Source-confirmed inconsistency | Fix / regression evidence |
|---|---|---|---|---|---|
| `src/app` / `src/app/page.tsx` | TODO (targeted fix present) | Authenticated homepage data isolation, marketing fallback | Workspace session, tenant lock, subscription status and live database clock | JSX returned inside an exception handler; CI ESLint `react-hooks/error-boundaries` failure on previous commit | `c9ff1f169`: render after the async try/catch; source contract test; new lint result pending |
| `odoo_addons/print_gateway/static/src/js` | TODO (targeted fix present) | Report interception + recovery + translated notifications | RPC boolean flags, operation ID reuse, print-outcome uncertainty, ar/en customer copy | Truthy nonboolean dispatch/success and raw remote diagnostic could misleadingly resolve an ambiguous print or leak credentials | `196f84da`: exact boolean gate and mapped, localized error boundary; real report-handler Node regressions; full CI incomplete |
| `docs/engineering` | TODO (audit ledger updated) | Review traceability / status reporting | Current main + required per-SHA CI, no source-of-truth substitution | High rate of concurrent main pushes has cancelled many CI runs before full gates finished | Record exact commits/results; never mark a module DONE without its tests and integration evidence |


### 2026-10-28 Odoo machine-error and ambiguous-outcome contract batch

| State | Module / directory | Responsibility | Shared contracts | Source mismatch | Fix and evidence |
|---|---|---|---|---|---|
| TODO (focused changes present) | `odoo_addons/print_gateway/static/src/js` | Browser limit dialogs and safe print outcome messages | Gateway 429 `PRINT_QUOTA_EXCEEDED` vs `TENANT_ENTITLEMENT_EXCEEDED`, immutable request ID, unknown physical outcome | Temporary capacity mapped to generic failure; embedded limit marker could override an explicit unknown outcome | `619bb88a` + `7e85bc45` apply code/entitlement precedence; regression tests added, full CI cancelled |
| TODO (focused tests authored) | `tests` | Vitest Odoo JS customer error boundary | Known and unrecognized codes, ar/en gettext lookup | No tests for contrasting technical limits and spoofed unknown+limit marker combinations | `tests/v4-odoo-errors.test.ts` regression matrix; full Vitest NOT RUN |
| TODO (source inspected only) | `src/app/api/print/jobs`, `src/lib/print-job-service.ts` | Gateway print admission and typed quota responses | Tenant/Agent/credential fences, month-credit ledger, v1/v2 identities | Source inspection observed strict key/mode checks; no new source mismatch established in this batch | Do not claim DONE until PostgreSQL concurrency, DB clock and Odoo wire roundtrip evidence |
| TODO (source inspected only) | `src/desktop/lib`, `src/lib/printer-identity.ts` | Desktop printer merge and IPC routing | Exact printer ID, agent-owned proof, inventory UUID and sharing | Source inspection found explicit duplicate/conflict filters; no end-to-end Windows printer verification performed | Keep TODO; require exact-SHA UI/Go/Windows acceptance tests |


### 2026-10-28 Continuation — bounded Agent-health read and physical output proof

| Module | State | Responsibility | Shared contracts | Finding / risk | Fix / regression / status |
|---|---|---|---|---|---|
| `src/app/api/agents/health` | TODO (targeted fix pushed) | Authenticated paginated live Agent fleet | `getAllAgentsHealth(tenantId, limit + 1, offset, tx)`; manager/tenant fences; headers | Missing lookahead always returned `x-has-more=false`, hiding later registered Agents | `8eceeb68` fixes query; route lookahead/last-page test; CI incomplete |
| `src/lib/agent-health.ts` | TODO (contract inspected) | Tenant-isolated Agent/printer/job health projection | Stable paging, `<=201` fetch, transactional read | Producer supports 201, route previously requested only 200 | No source change; module contract updated in tests; integration NOT RUN |
| `tests/agent-health-*.test.*` | TODO (new coverage pushed) | Pagination and live-owner/session regression | Next offset, first+last page, strict bounds | Old Node contract assumed three parameters and an unprotected read | Unit route harness and native contract tests in `8eceeb68`; full CI not verified |
| `tests/audit-gateway-offline.test.mjs` | TODO (VM repaired) | Real Gateway/agent diagnostics and spooler capability contract | UTF-8 `TextEncoder`; transaction authority, no forged printer identity | Node VM silently rejected valid printers because `TextEncoder` was absent; outdated `db.query` assertion | `993f1343` uses actual runtime encoder and locked `tx.query` assertions; unverified |
| `tests/kitchen-lifecycle-runtime.test.mjs` | TODO (proof test updated) | Odoo kitchen retry, accepted subset and ambiguity | `can_retry=true` only with proven zero-output | Old fixture assumed any `failed` status was retryable | `65dcab27` explicit acceptance evidence and ambiguous no-reprint regression |
| `tests/helpers/odoo-printer-geometry.mjs` | TODO (mock proof aligned) | Native Odoo printer proof fixtures | Go/Gateway queue/service/device strength by protocol | Invalid helper claimed Windows queue for SNMP/USB/IPP | `1e08fea3` native-proof regression; end-to-end Windows NOT RUN |
| `odoo_addons/print_gateway/static/src/js/pos_print_router.js` | TODO (targeted fix pushed) | Receipt/kitchen submission, safety feedback, no ambiguous retry | Machine code + i18n, `UNKNOWN_*` physical uncertainty | Raw backend strings leaked; contradictory code could suggest safe retry | `2d7f5066` safe localized presenter + code precedence; Odoo 19 installed runtime NOT RUN |
| `.github/workflows` | TODO (per-SHA CI observation) | CI/Windows/Go/Docker/security gates | Success only on completed exact-SHA workflow | High-frequency concurrent main pushes cancel CI before complete qualification | Log every workflow's real conclusion; do not mark full release PASS |
