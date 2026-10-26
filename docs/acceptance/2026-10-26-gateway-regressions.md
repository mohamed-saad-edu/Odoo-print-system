# Current-tree implementation and verification — 2026-10-26

Verdict: **NO-GO for production release**. The two reproduced Gateway defects
below are fixed and software gates pass on the available toolchains. Real
Windows, printer, live Odoo and release-image evidence is still missing. No live
deployment was performed and no local packages or toolchains were installed.

Baseline: the clean current `main` working tree. No other branch, archive or
historical report supplied implementation evidence. The existing Graphify graph
was used only to locate paths; current source and executable regressions supplied
the findings. Logs are local in `/tmp/yaseir-verification-20261026/`, not committed
build artifacts. This is scoped verification, not proof that every platform path
is defect-free.

## Reproduced and fixed

| Finding | Root cause and invariant | Implementation and regression evidence |
| --- | --- | --- |
| P1: admission/delivery replay renewed stalled leases | `recordJobAck` refreshed `updated_at` on every duplicate or late ACK; `markJobDelivered` also replaced delivery time. Maintenance uses `updated_at` for timeout classification. Old admission evidence must not impersonate fresh execution progress. | `26875d9`: `src/lib/job-delivery.ts` preserves first evidence timestamps, updates lease time only for first evidence while claimed, and keeps claim/tenant/Agent fencing. Five new cases in `tests/ws-ack-tenant-fence.integration.test.ts` failed before the fix. The three targeted delivery suites then passed 65 tests, including UNKNOWN classification and preserved reconciliation tokens. |
| P1: same local discovery ID collided across Agents | The database required tenant/device-ID uniqueness while stable identities and approval URLs were Agent-scoped. Concurrent reports from two Agents hit SQLSTATE `23505`. Three provisioning writes also lacked the Agent predicate needed by the wider identity. IDs must remain unchanged and candidates must never inherit another Agent's approval or runtime link. | `51fa4ab`: migration `0097`, `src/db/schema.ts`, discovery ingestion and all affected provisioning writes now use tenant/Agent/device scope. The ingestion regression failed before the change. Five added cases cover concurrent same-ID reports, independent rediscovery, repeated migration with retained evidence, and all three provisioning paths. The discovery/approval suites passed 27 tests; migration-upgrade coverage also passed. |

The checked-in Drizzle snapshot, journal, wire-contract documentation, database
reference, migration inventory and affected regression fixtures were updated
together. Migration `0097` changes constraints only: it does not rewrite rows,
external IDs, approvals, printer links, payloads, counters or credentials.

## Current source map and exercised boundaries

Odoo reports/POS enter `odoo_addons/print_gateway/models/print_router.py`, binding
and policy validation, then durable intents/jobs in `print_intent.py` and
`print_job.py`. `gateway_http.py` transports them to Gateway print routes.
`src/lib/odoo-idempotency.ts`, `odoo-v2-admission.ts` and `print-job-service.ts`
bind accepted business identity to tenant, enrolled installation and document
operation, retain receipts, serialize admission and reserve monthly quota.

`src/server/ws.ts`, `src/lib/job-delivery.ts` and
`src/app/api/agent/jobs/route.ts` claim and deliver work under attempt tokens.
`agent/internal/agent/agent.go` and `agent/internal/queue/` persist local admission,
execution and terminal outbox evidence. Printer backends perform the selected
spooler/GDI, IPP, RAW, USB or approved PDF-file operation. Fenced Agent status
reports and `src/lib/odoo-status-scope.ts` return the result to the saved Odoo
installation. Accepted, claimed and successful submission do not prove paper
output. UNKNOWN is never automatically reprinted.

| Boundary reviewed | Current source / executable coverage | Limits |
| --- | --- | --- |
| Tenant, installation, company and branch authority | Gateway tenant-isolation, Odoo status-identity, password/invitation, print-idempotency and quota integration suites; Odoo router/binding/policy Python tests | No live Odoo installation or production tenant inspected |
| Claim fencing, duplicate/out-of-order reports, lost results | Delivery/ACK regressions, status-concurrency, ambiguous-outcome and multi-instance Gateway suites; Go race tests and SQLite/outbox tests | No physical exactly-once guarantee |
| SSRF, IDOR, CSRF, XSS and traversal | Printer destination/network-address validation; Odoo pinned transport; custom HTTP request guard; nonce/CSP, raw-target HTTP acceptance and desktop path/command tests | No external penetration test or hosted scanner result |
| Database least privilege and migration preservation | Production role acceptance on a second fresh disposable PostgreSQL cluster; migration upgrade/hash/rollback and new repeatability tests | Production cluster roles and backups not inspected |
| Printer identity and media | Gateway candidate/registration boundaries; Agent registry/UUID, GDI/IPP/PDF and receipt geometry tests; Odoo receipt/font/RTL tests | A4/Letter/58/80 mm paper output and Arabic shaping on actual devices NOT RUN |
| Windows service and desktop context | Source tracing through native spooler/USB discovery, dispatch, desktop IPC and protected local storage; existing Go/Python regressions | SCM, interactive user visibility, GDI, MSVC, installer and signing NOT RUN |
| Deployment, CI and bounded work | Compose build-context validation; sequential deployment script and CI scope regression coverage; source audit found zero structural blockers | Actual release-image builds, small-VM load, hosted CI and live cloud/TLS NOT RUN |

## Gate evidence

Available local tools: Node `24.21.0`, npm `11.19.0`, Go
`1.26.9-X:nodwarf5`, Python `3.14.8`, Rust `1.98.1`. These are not all repository
pins: `.nvmrc` specifies Node `24.22.1`, `packageManager` npm `12.2.1`, and
`agent/go.mod` Go toolchain `1.26.10`. No replacement was installed. A local pass
does not establish a pass on those exact pinned environments.

Commands below ran from the repository root unless stated otherwise. Database
commands used only newly created synthetic PostgreSQL containers, published on
loopback ports 55439/55440 with tmpfs storage. Credentials were disposable and
are intentionally omitted. No existing database or deployment was targeted.

| Gate / exact command | Result | Evidence |
| --- | --- | --- |
| `npm run build` | PASS | `build-final.log`, exit 0, production webpack build |
| `npm run desktop:vite:build` | PASS | `desktop-vite.log`, production frontend built; existing bundle-size warning over 500 kB retained |
| `npm run typecheck` | PASS | `typecheck-final.log`, exit 0 |
| `npm run lint` | PASS | `lint-final.log`, exit 0, ESLint and oxlint |
| `npm run test:unit` | PASS | `unit-final.log`: 240 files, 1,928 tests |
| `npm run db:migrate` then `RUN_MULTI_INSTANCE_TEST=1 RUN_DB_BACKED_ACCEPTANCE=1 npm run test:integration` | PASS | `migrate-final.log`, `integration-final.log`: 90 files, 782 tests, zero skips |
| `node --experimental-vm-modules --test tests/*.test.mjs` | PASS | `node-final.log`: 670 tests, zero skips |
| `python3 -m pytest tests/test_*.py` | PASS | `python-final.log`: 1,209 tests; 57,436 dependency deprecation warnings retained |
| In `agent/`: `go test -mod=readonly -race -vet=all ./...` | PASS | `go.log`: all ten package results `ok`; `go mod verify` also passed |
| `npm run i18n:check`, `npm run i18n:odoo:check`, `npm run db:docs:check`, `npm run typography:check` | PASS | Separate named logs; 2,896 keys per web locale, 849 Odoo Arabic entries, 34 tables / 98 migrations |
| `APP_BASE_URL=https://audit.invalid GATEWAY_DOMAIN=audit.invalid python3 scripts/check-compose-build-contexts.py` | PASS | `compose-contexts.log`; resolved local Dockerfiles/contexts exist |
| `python3 tests/production-source-audit.py --output /tmp/yaseir-verification-20261026/production-source-audit.json` | PASS | `source-audit.log`: zero structural blockers; six unreferenced-file candidates, not confirmed dead code |
| `node --import tsx scripts/acceptance/postgres-roles.mjs /tmp/yaseir-verification-20261026/roles-ready` | PASS | With `YASEIR_FRESH_ROLE_CLUSTER=1` and isolated PG environment: 22 checks, including denied DDL/cluster/audit mutation and preserved rollback evidence |
| `node node_modules/tsx/dist/cli.mjs scripts/pg-notify-failure-injection.ts` | PASS | `notify.log`: forced listener termination followed by a new connected backend |
| In `src-tauri/`: `CARGO_NET_OFFLINE=true cargo test --offline --locked` | BLOCKED | `rust.log`, exit 101: missing system `glib-2.0` development/pkg-config files; no installation attempted |
| Exact pinned Node/npm/Go environment | NOT RUN | Available versions above differ from pins |
| Real Windows, live Odoo, physical printers, signed installers | NOT RUN | No evidence available |
| Actual production Docker images, cloud deploy, hosted scanners/CI | NOT RUN | No live deployment or scanner installation performed |

Setup failures and red runs were retained, not counted as passes. The first
integration run preceded public-schema migrations and failed HTTP catalog
acceptance; it also caught the five new delivery regression cases before their
fix. The final migrated run passed all 782 tests. Typecheck was once started
alongside Next build, which regenerated `.next/types`; the sequential rerun
passed. Two hard-coded migration-inventory expectations failed after adding
`0097`; inventories were updated and the full Python rerun passed. Role
acceptance was initially started before PostgreSQL readiness; after explicit
`pg_isready`, its fresh result directory recorded all 22 passes.

PostgreSQL semantics were checked against the official
[date/time documentation](https://www.postgresql.org/docs/16/functions-datetime.html):
`clock_timestamp()` reads actual time, while transaction timestamps are fixed.
No lease behavior was hidden with sleeps or automatic print retries.

## Remaining issues and release/rollback conditions

- **P1 release gate:** real Windows service versus interactive discovery,
  native dispatch, driver media adaptation and actual printer outcomes remain
  unverified. Complete the existing Windows acceptance process for the exact
  candidate before production release.
- **P2 verification:** Rust desktop build is blocked locally; exact pinned
  toolchain, real Odoo/POS, final Docker images, hosted security scans and cloud
  acceptance still need their own recorded results. Source/catalog checks do
  not establish visual RTL or physical Arabic receipt correctness.
- **P3 maintenance:** six unused-file candidates were left intact because the
  structural inventory is not sufficient proof of dead code. Python dependency
  warnings and the desktop frontend bundle-size warning remain visible. No
  dependency upgrades were made.

Before an authorized deployment, back up PostgreSQL and separately preserve the
Odoo database/filestore and protected Agent state. Stop older Gateway writers,
apply `0097` with the migration owner, verify runtime privileges, then start the
matching fixed Gateway. Use the repository's sequential Compose build procedure
on small VMs; this run did not execute a deployment.

Do not roll back to the old Gateway against a schema that now admits duplicate
local device IDs across Agents: its provisioning predicates lack the Agent
fence. Prefer a reviewed forward repair. Restoring tenant/ID uniqueness requires
explicit reconciliation, never deleting observations or renaming external IDs.
Keep UNKNOWN jobs and their claim/receipt evidence; rollback must not requeue
them. Updating the Gateway does not update an Odoo addon on a separate server;
addon upgrades and live Odoo validation require their own deployment step.
