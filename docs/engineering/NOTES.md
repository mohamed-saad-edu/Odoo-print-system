# NOTES.md — source-wide engineering coverage (GitHub-only review)

Baseline inspected: main@65214cf7948a214843110fa2fbc1a23aec388340. This is an **open coverage ledger**, not a release certificate. Counted 1898 repository files by GitHub tree. A directory is DONE only after its entire logic and contracts have been independently reviewed; none are signed off by this narrow batch. The more detailed existing file ledger is `docs/engineering/FILE_COVERAGE_LEDGER.md`.

| Directory | Files | Status | Logic | Shared contracts | Observed issue / next action |
|---|---:|---|---|---|---|
| `.github/` | 8 | TODO | CI workflow orchestration, security gates, release builds | Build and security workflow contract | Verify all workflows for the same main SHA; no local runner |
| `agent/` | 359 | TODO | Go Agent transport, Windows service, discovery and durable execution | job-state/unknown outcome, printer identity, geometry | Cross-check Go native Windows paths and hardware outcomes |
| `contracts/` | 8 | TODO | Wire and hardware specification fixtures | Gateway/Agent/Desktop/Odoo schemas | Run contract suites and check all producers |
| `docs/` | 43 | TODO | Product, operations, migrations and engineering records | Manually approved subscription and safe recovery documentation | Reconcile stale historical rolling-quota prose with 0102 cutover |
| `drizzle/` | 138 | TODO | PostgreSQL forward-only migrations and tenant-isolated schema | UTC usage ledger, tenant keys, idempotency | 0102 preserves historical rows; validate on a production-like database snapshot |
| `odoo_addons/` | 105 | TODO | Odoo addon, POS/report hooks and durable outbox | v1/v2 namespace, status and local retry safeguards | Cross-check locale and Gateway rejection shapes |
| `scripts/` | 65 | TODO | Migrations, acceptance, maintenance and release validation | CI/database migration safety | Execute full acceptance in authorized environment |
| `security/` | 7 | TODO | Security constraints and vulnerability baseline | SCA, package hardening, deployment | Audit current CVEs and expiring exceptions |
| `src-tauri/` | 192 | TODO | Native Desktop bridge and Rust runtime | Agent IPC, scoped pairing, credential privacy | Run native integration and Windows acceptance |
| `src/app/` | 158 | TODO | Next.js pages, routes and customer/admin actions | subscription status, tenant/role checks, printer APIs | Sampled routes match live contract; review rest including error shapes |
| `src/components/` | 27 | TODO | Gateway UI, billing and operational components | AR/EN status presentation and authorization | Confirm Full Access and owner-only actions everywhere |
| `src/db/` | 3 | TODO | Drizzle schema and DB client | FKs, tenant isolation and time authority | Inspect every relation and migration compatibility |
| `src/desktop/` | 26 | TODO | Webview Desktop interfaces | Gateway bridge, locale, printer controls | Check error codes and geometry on native bridge |
| `src/i18n/` | 10 | TODO | English/Arabic resources and translation tools | Api error keys and RTL | Audit unused legacy trial/Stripe copy and live output |
| `src/lib/` | 118 | TODO | Gateway domain services | Billing, idempotency, print state, identity and authorization | This batch unifies duplicated SQL gates; rest requires review |
| `tests/` | 570 | TODO | Unit, integration, native and contract regressions | Runtime policy and cross-layer proof | Targeted test added; run full suite via Actions |
| `root` | 46 | TODO | Build manifests, compose, deployment interfaces | Release and live configuration | Release gate remains unverified |

## Batch 1 — subscription admission rule

**Finding:** `liveTenantSubscriptionWhere` and `liveTenantSubscriptionPredicate` carried duplicated active-contract/expiry/unblocked SQL text. A later change to one side could silently grant provisioning/agent claims while denying another path.

**Fix:** The correlated predicate embeds the exact row predicate, retaining all active/manual, start-time, finite expiry, database clock and entitlement-block gates. Add `tests/billing-live-predicate-contract.test.ts` to verify the same compiled SQL for blocked and unblocked contexts and keep a source-level single-definition guard.

**Verification:** GitHub-only connector cannot run a local unit suite or PostgreSQL tests. **NOT RUN** until an exact-commit GitHub Actions run finishes. No test was disabled. No new migration, data update or deployment.

## Pre-existing main fixes observed (independent authorship)

- `36114a8873a7`: blocked-entitlement fixture given finite future expiry.
- `5abd6458d63d`: UTC calendar month via forward-only `0102`, with retained historical usage (possible conservative overlap).
- `972d7df3f830`: workspace-owner invitation authority and Odoo quota copy.
- `22457a3b8b19`: distinct Arabic/English quota error.
- `8b677ba5a986` and later commits: admin status uses runtime live predicate.

## Open gates

- **High (BLOCKED):** Live print/Windows hardware, failover/ambiguity, Odoo integration and full Postgres migration rehearsal not executed here.
- **Medium (TODO):** Every unreviewed directory above; owner-only UI/read authorizations, printer identity/geometry, cross-language status and API shape.
- **Medium (BLOCKED):** New commit's CI status must be collected before release. Other sessions are pushing to main concurrently; workflow cancellation is not a successful run.
- **Low (TODO):** Reconcile historical rolling-quota language in older engineering notes; historical ledger rows must remain intact.
