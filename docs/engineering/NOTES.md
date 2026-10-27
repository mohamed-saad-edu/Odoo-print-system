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


## Batch 2 — length-bounded, authenticated printer aliases

**Root cause:** `src/lib/printer-identity.ts` appended an eight-hex Agent suffix to any local printer ID, but the heartbeat contract accepts only 120-byte printer IDs: a 120-byte ID produced a 129-byte alias. The Go Agent's `resolvePrinterAlias` also removed **any** syntactically valid eight-hex suffix and selected the matching local backend without checking its hash or Agent ID. This is a cross-layer wrong-printer authority gap.

**Change:** Gateway caps the retained local-ID prefix at 111 UTF-8 bytes while preserving all 8 hash characters. Go independently recreates the exact bounded alias from its current configured Agent identity and local printer ID; a forged, foreign-Agent or ambiguous alias now fails closed instead of selecting another local backend. Valid previously issued short aliases remain valid. No printer history, tenant IDs, physical proof or historical print job is modified.

**Regression authored:** `tests/heartbeat-printer-alias.unit.test.ts`, `agent/internal/agent/printer_alias_contract_test.go` and existing Agent alias tests now cover ASCII/UTF-8 length, exact printer, foreign Agent, forged hash and local sharing denial. Tests are NOT RUN until the corresponding exact-SHA GitHub Actions jobs complete; physical printer output remains BLOCKED.

**Detailed directory inventory:** [MODULE_COVERAGE_LEDGER.md](MODULE_COVERAGE_LEDGER.md) enumerates all 268 directory modules with evidence boundaries. The pre-existing [FILE_COVERAGE_LEDGER.md](FILE_COVERAGE_LEDGER.md) continues to index every tracked file. Directory mapping is not a complete correctness review.

## Batch 3 — explicit ambiguous physical outcomes / conflicting PDF proof

**GitHub commit:** `58decf49d252c0d7d8e98c83413e1bac5a0c4855`.
**Finding:** `derivePhysicalOutcome(status='unknown'/'partial')` previously concluded `not_printed` when an error prefix was missing, while Odoo's `job_customer_state` could show `file_created` for a failed or unknown operation with a stale `output_outcome=file_created`.
**Fix:** Keep both explicit ambiguous statuses as `unknown` physical outcome, and require `success` for the Odoo file-created customer label. Retain evidence and avoid automatic replay. Regressions: `tests/physical-outcome.test.ts`, `tests/test_v4_odoo_customer_presentation.py`.
**Verify:** CI on exact commit pending/cancelled by concurrent main updates; physical hardware NOT RUN.

## Batch 4 — missing-expiry customer subscription UX

**GitHub commits:** `ca0c8ec78f67a3f6ee5b6a686c132219dc031924`, `9854d7aee4a4e9fbcfcd409e8c9db4bb83ab1eab`.
**Finding:** The special missing-expiry warning was unreachable because the runtime correctly reports `expired` for an open-ended active manual contract, while the alert required `status='active'`.
**Fix:** Match the displayed `expired` state to a persisted `active/paid` contract missing its end date. Keep print admissions fail closed; no data reset. Regression in `tests/billing-renewal-ui.test.ts`.
**Verify:** Only the source and pushed commits verified; targeted CI for exact commit NOT RUN / cancelled as newer main commits superseded it.

## Batch 5 — stored printer identity must never override an invalid current endpoint

**GitHub commits:** `4b23074b6dd9f29ebaf654f42624ef546f1249dd`, `64b0b78cf448a4293f79117fc60e9ecf26cd41a7`, `ff9a3b2e100c95dfd26663674ab884fa5db927a7`.
**Finding:** `matchingPhysicalPrinter` and Agent heartbeat discovery fell back from a failed live endpoint parse to a persisted `physicalIdentityKey` that could describe an older configuration. Example: a legacy row has an invalid string port but a stored key for another configured printer; it would suppress/reuse the wrong endpoint.
**Fix:** Resolve dedup using only reconstructable current endpoint identity. Missing/malformed legacy configurations stay unverified rather than matching an unrelated printer. Unit and heartbeat source-contract regressions in `tests/physical-printer-identity.test.ts`.
**Verify:** Exact-commit Gateway and real printer acceptance NOT RUN/cancelled due concurrent pushes; status remains TODO, not DONE. No historical printer rows were deleted.

## Current audit limitation

`MODULE_COVERAGE_LEDGER.md` is the full directory inventory; `FILE_COVERAGE_LEDGER.md` is a file enumeration. The three batches above are targeted verified-source findings, **not** a line-by-line review of all 1,900+ paths. Remain TODO/BLOCKED until the exact latest SHA's full CI and hardware/staging acceptance run. Never equate a cancelled or skipped workflow with PASS.
