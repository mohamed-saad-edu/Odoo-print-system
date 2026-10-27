# Yaseir — unified system logic & engineering notebook

> Living architecture/consistency register. Baseline: `main@4f48736f100a438609a0a9bbdc7866bff5495f73`, 2026-10-28. This is an **evidence-scoped** engineering note, not certification that every file, hardware printer, deployment or behavior was inspected. All 1892 tracked source/repo files are indexed individually in [FILE_COVERAGE_LEDGER.md](FILE_COVERAGE_LEDGER.md); the majority remain INDEXED rather than reviewed.

## 1. Truth and ownership boundaries

| Domain | Authoritative owner | Source touchpoints | Cross-component contract |
|---|---|---|---|
| ERP company, branch, reports, POS context and print intent | Odoo | `odoo_addons/print_gateway/`, `ODOO_INTEGRATION.md` | Odoo keeps business records, bindings and durable outbox; Gateway does not mirror ERP business models |
| Tenant lifecycle, identity, sessions and privileges | Gateway + PostgreSQL | `src/lib/authorization.ts`, `src/lib/tenant-guard.ts`, `src/lib/customer-auth.ts`, `src/db/schema.ts` | All tenant-scoped reads and writes must enforce current tenant and actor; password-only human login |
| Plan catalog and billing contract | Platform admin mutation in Gateway | `src/lib/manual-subscriptions.ts`, `src/lib/entitlements.ts`, `src/lib/plan-price.ts` | Manual request, separate explicit approval; catalog USD/SAR amounts are display metadata, not automatic payment |
| Print credit admission | Gateway transaction + PostgreSQL clock | `src/lib/quota-cycle.ts`, `src/lib/entitlements.ts`, `src/lib/print-job-service.ts`, `drizzle/0101_rolling_print_allowance.sql` | One accepted logical job consumes one credit; fixed 30×24-hour UTC cycles anchored to first real activation, **separate from manual contract term** |
| Printer inventory and capability | Go Agent observation, Gateway durable runtime inventory | `agent/internal/agent/`, `src/lib/printer-identity.ts`, `contracts/printer-presentation-contract.json` | Stable tenant+Agent+logical-queue identity; physical capability and lifecycle/health are separate |
| Print jobs and delivery | Gateway durable job/receipt record; Go Agent physical execution and SQLite recovery | `src/lib/print-job-service.ts`, `src/lib/job-status.ts`, `agent/internal/agent/` | Idempotency + claim fencing + durable replay; no assumption that transport submission means paper printed |
| Local desktop manager | Tauri/native Agent bridge | `src/desktop/`, `src-tauri/src/`, `contracts/gateway-console-contract.json` | Bounded IPC; Agent credentials stay native, not exposed to desktop renderer |
| Data layout, forward upgrades, deployment | PostgreSQL migration ledger + release gate | `drizzle/meta/_journal.json`, `scripts/db-migrate.ts`, `MIGRATION.md`, `.github/workflows/` | Forward-only migrations, backup/rollback evidence, no production data reset |
| Arabic/English presentation | Per-component localization with shared concepts | `src/i18n/`, `odoo_addons/print_gateway/i18n/`, `src/desktop/` | Proper RTL, English parity, logical-identity-safe numeric and currency formatting; public-facing copy says “Odoo”, not a product-wide version guarantee |

Existing machine-readable contracts in `contracts/`: gateway-console bridge, print payload, printer geometry (plus fixtures), operational verification (plus fixtures), presentation, and printer sharing. These contract files are reviewed as boundaries, not licenses to duplicate independently evolving rules.

## 2. End-to-end flows that must agree

1. **Signup → email verification → password setup → workspace session.** Email proof is single-use, bounded and not itself a session. No MFA. Invitation acceptance joins an existing tenant and must not create a second workspace. Primary code: `src/app/api/auth/`, `src/lib/invitation-join.ts`, `src/lib/session-tokens.ts`.
2. **Plan request → operator review → manual approval → entitlement admission.** A request is not activation. Plan price is optional USD/SAR metadata, independent of contract and quota. Contract start/end gates must not be replaced with credit reset windows. Primary code: `src/lib/manual-subscriptions.ts`, `src/app/billing/page.tsx`, `src/lib/entitlements.ts`, `drizzle/0095_manual_subscriptions.sql`, `drizzle/0100_plan_prices.sql`, `drizzle/0101_rolling_print_allowance.sql`.
3. **Agent pairing → discovery → physical queue identity → verification → destination binding.** Odoo owns document/POS bindings; Gateway owns physical runtime IDs. A discovery report does not automatically authorize an unverified printer. Primary code: `src/lib/printer-identity.ts`, `agent/internal/agent/discovery_manager.go`, `contracts/printer-operational-verification-contract.json`.
4. **Odoo intent → durable outbox → Gateway admission → claim → Agent execution → terminal evidence → reconciliation.** Replays reuse idempotency identity, quota is reserved only on first admission, and ambiguous transport/physical outcomes remain unknown until proof. Physical output must never be asserted from HTTP/spooler acceptance alone. Primary code: `odoo_addons/print_gateway/`, `src/lib/odoo-v2-admission.ts`, `src/lib/print-job-service.ts`, `src/lib/job-status.ts`.
5. **Suspend/expire/delete/revoke → in-flight operations and history.** Recheck current actor and tenant in transactions; preserve accepted-job and receipt evidence, avoid resurrecting revoked API keys or silently reprinting uncertain jobs.

## 3. Canonical invariants and verification owners

| ID | Invariant | Source of policy | Verification evidence still required |
|---|---|---|---|
| AUTH-01 | Password-only, no MFA screens, legacy factor columns only historical and retired | `drizzle/0093_password_only_authentication.sql`, `SECURITY.md` | User session, email, password/reset and invite E2E |
| AUTH-02 | Owner vs Full Access: members operate; commercial details owner-only; invitations scoped to the verified workspace owner role, independent of global Platform Owner identity | `src/lib/authorization.ts`, `src/lib/workspace-owner-invitations.ts` | Cross-role and cross-tenant permission integration |
| BILL-01 | Manual subscriptions only; no automatic activation, checkout, provider billing mutation | `src/lib/manual-subscriptions.ts` | Request/approval/revoke transaction cases |
| BILL-02 | Credit cycle = 30 UTC days from original activation; no reset on term changes, duplicate admission or annual renewal | `src/lib/quota-cycle.ts`, `drizzle/0101_rolling_print_allowance.sql` | UTC boundaries, New Year/leap, concurrency, historical cutover |
| BILL-03 | Current subscription page does not advertise plan choice as if already uncontracted; active contract and allowance truthful | `src/app/billing/page.tsx`, `src/app/pricing/` | Owner/member view, pending/active/suspended/expired E2E |
| PRINT-01 | Odoo sole owner of ERP business bindings and intent, Gateway sole owner of runtime printer identities | `ARCHITECTURE.md`, `ODOO_INTEGRATION.md` | Odoo POS/report/branch/company integration |
| PRINT-02 | One logical intent → one Gateway job, one print attempt unless an explicitly authorized operator reprint | `src/lib/odoo-v2-admission.ts`, `src/lib/print-job-service.ts` | Network failures, reconnect, parallel admissions, duplicate print regression |
| PRINT-03 | Job DB statuses and physical outcome labels remain distinct; unknown is never counted as proven printed | `src/lib/job-status.ts`, Go Agent durable output markers | Real Windows spooler and printer fault injection |
| PRINT-04 | Printer identity stable through discovery/manual/agent restart; sharing and verification gates preserved | `contracts/printer-sharing-contract.json`, `src/lib/printer-identity.ts` | Windows, IPP, USB discovery and real printer |
| DATA-01 | Tenant isolation by scoped app queries and composite FKs; PostgreSQL RLS not claimed as present | `src/db/schema.ts`, `ARCHITECTURE.md` | Unauthorized principal/query test matrix, RLS defense-in-depth review |
| DATA-02 | 102 immutable SQL migrations through `0101`; no rewriting old applied migrations | `drizzle/meta/_journal.json`, `MIGRATION.md` | Fresh PostgreSQL replay, populated migration, backup/restore |
| UX-01 | EN/AR parity, semantic RTL, bidirectional numerals and currencies; no customer test center | `src/i18n/`, `scripts/check-i18n.ts` | Browser snapshots, Odoo screen tests, desktop Windows screenshots |
| DEPLOY-01 | Do not weaken Trivy or test gates and claim production success | `.github/workflows/`, `security/image-vulnerability-baseline.json` | Image rescans, full CI, staging, device acceptance |

## 4. Issue/evidence register (snapshot, update with new runs)

| Key | Severity / state | Evidence / root cause | Next safe action |
|---|---|---|---|
| AUD-001 | Historical CI failure; later main CI PASS | `main@3fb9efab` Python checks expected migration 0100 after migration 0101; 2 failed, 1249 passed in CI run 40587441789. Later `main@33d528ec` updated the two assertions and `MIGRATION.md`. | Run complete CI on exact updated commit; never rewrite SQL journal history |
| AUD-002 | Documentation drift; corrected in this note's change set | `docs/DATABASE.md` still said 99 migrations through 0098 despite 102 through 0101. Migration 0100 adds display prices and 0101 adds immutable print-credit anchor. | Keep the database reference and verification matrix in sync with each forward migration |
| SEC-001 | Historical scan failure; latest hardened-image gate PASS, verify SARIF | Run 40587441789 Odoo hardened-image Trivy gate found new unreviewed `CVE-2026-111497` in Ubuntu `libbrotli1` (reported MEDIUM). The gate correctly refused the finding; 64 reviewed findings still remain under expiring exceptions. | Rebuild immutable Odoo runtime with verified Ubuntu 24.04 `libbrotli1 1.1.0-2ubuntu0.1` or later patched version, record artifact SHA-256 and update pinned Dockerfile/profile; rerun scan and full Odoo suite. **Do not add the CVE to exceptions just to turn CI green.** Canonical notice: https://ubuntu.com/security/notices/USN-8956-1 |
| AUTH-INV-001 | Product-contract review, not proven exploit | `requireWorkspacePlatformOwnerForInvites` requires `users.is_platform_owner=true` in addition to a valid workspace session; `tenant_users.role=owner` by itself cannot invite. If “workspace owner invites” is intended, business policy and authorization tests need reconciliation. | Confirm intended authority without broadening access unintentionally; preserve fail-closed policy until verified |
| SEC-002 | Known defense-in-depth gap | Architectural documentation states no DB RLS; app-level tenant filters and composite FKs are the boundary. | Audit every tenant-scoped raw SQL/API edge; consider RLS rollout under isolated migration/test |
| HW-001 | **NOT VERIFIED** | No real Windows SCM/GDI, exact physical printer, POS, network-partition, or production deploy evidence was produced in this audit. | Execute the listed release gates with authorized hardware/staging and keep outcomes attached to exact commit |

## 5. Coverage protocol and release gate

The file ledger records **all tracked paths**, not a false claim of line-by-line audit. To move a file/component from INDEXED to REVIEWED, record which interfaces and trust boundaries were traced, concrete defect hypothesis, regression test that reproduces it, fix and the test's real output. A green static test is not proof that a physical receipt printed.

Verification sequence: immutable migration journal parity → type/lint/localization and static contracts → PostgreSQL integration/migration replay → Python/Odoo module tests → Go race and worker tests → Rust/Tauri build and Windows installer lifecycle → hardened images + fresh Trivy → staged E2E with actual authorized printer and restored backups. Track failures by commit and job URL. Never change old migration hashes, erase historical print evidence, fabricate tests, bypass security checks or reset customer data to obtain a pass.

## 6. Next implementation queue (priority order)

1. **P0**: Close SEC-001 by adding the checksum-verified patched OS package and full image rebuild/rescan; do not promote a known vulnerable image.
2. **P0**: Verify `main@33d528ec` and successor commits in complete CI, especially old migration tests and 0101 rolling-credit usage at tenant/company boundaries.
3. **P1**: Review and prove owner/Platform Owner invitation + billing authority across UI, API and DB transactions; test current state and avoid confusing UI copy.
4. **P1**: Contract-test Odoo ↔ Gateway ↔ Agent status mapping, idempotency/physical unknowns, PDF/POS/receipt output and discovery identity, including failure injection.
5. **P1**: Cross-language Arabic/English, RTL, terminal state copy, billing percentages and currency presentation snapshots.
6. **P1**: Real Windows and physical printing, database restore, load/capacity, server reverse-proxy and deployment verification.
7. **P2**: Refactor genuinely duplicated domain logic only after regression coverage proves replacement has identical contract behavior.

**Audit status**: scoped repository-index inspection plus evidence-backed CI fault analysis, not a comprehensive line-by-line source audit or production-ready signoff. Future contributors should amend this notebook and the file ledger on every relevant fix, including exact git SHA, test command, job URL, environment and remaining risks.

## 7. 2026-10-28 live cross-component review: invitation privacy and POS replay

**Baselines**: Earlier `main@934582e57e0758f9890c7ed4f3de010916d474f7` passed CI (run `40591605908`), Docker (`40591605916`), Windows installer (`40591605858`) and the three security/native gates (`40591605849`, `40591605835`, `40591605825`). This is automated gate evidence, not blanket production readiness. The Odoo CI workflow runs Trivy against the exact hardened test image and applies a fail-closed reviewed-finding policy. The historical `SEC-001` CVE is not in the current exception list. The actual SARIF and runtime image still require a release review.

**AUTH-INV-READ-001 — historical authorization inconsistency (fixed owner-only GET in an earlier commit)** (`main@88a894133d70df8516c7f6a42cef468eaa17852c`). `GET /api/team/invitations` previously required only `users.read`, granted to Full Access members. It returned pending invitation recipients' email addresses, IDs and expiry dates. `POST` / `DELETE` used `requireWorkspacePlatformOwnerForInvites`, while the Team page hid only the mutation controls but fetched and rendered pending recipients for every member. The list did **not** include invitation secret tokens. This violated the owner-only invitation privacy boundary, even though the write boundary was protected.

**Change**: the GET now guards the same verified Platform Owner session as invitation writes inside a tenant-scoped database transaction. The UI loads profile/member data first, then fetches and displays invitations only for the verified owner. Full Access retains teammate visibility without a failing owner-only request. Regression cases now cover denied Full Access reads, permitted verified owner read, no token-hash exposure and immediate denial after owner identity revocation. No auth role widening, manual subscription or password policy change was made.

**Odoo event observed during audit**: `main@88a894133d70df8516c7f6a42cef468eaa17852c` added an explicit-reprint policy for *billing-denied POS and kitchen receipts*, rather than silently replaying old receipt intent after renewal. This is distinct from ordinary documents that can remain queued and recoverable. Future print lifecycle audits must preserve the durable record while forbidding surprise receipt replay; accepted jobs/physically uncertain attempts must keep their separate reconciliation rules. The live hardware and Windows checks remain unverified.

**Test evidence**: The two additional integration tests are new source coverage, not yet proof of execution; record the CI result for the resulting exact commit. A separate policy question remains about `tenant_users.role=owner` versus the currently enforced `users.is_platform_owner` authority; do not widen the guard without a deliberate decision and role matrix.


## 8. Policy conflict: calendar UTC month versus rolling 30-day print credits

**State: OPEN / P0 policy consistency — do not silently migrate production accounts.** The previously specified customer billing behavior is that usage credits reset at **00:00 UTC on the first day of each calendar month**, while financial contract renewal remains manual and an expired contract still blocks new admissions. This conflicts with current `main` implementation: `src/lib/quota-cycle.ts` uses `QUOTA_CYCLE_MS = 30 * 24 * 60 * 60 * 1000` and PostgreSQL `date_bin(interval '30 days', ...)`; `drizzle/0101_rolling_print_allowance.sql` migrated usage from calendar windows to rolling windows anchored to first activation. This is a verified **requirements–implementation divergence**, not a claim that either implementation crashes.

**Required unified remediation (not implemented by this note):**
1. Record an explicit product decision and migrate **forward** with a new numbered migration (never rewrite 0101 or reset customer usage/history). Define fair cutover rules for currently active 30-day cycles, historical monthly ledger keys, and already accepted jobs; consider a shadow comparison/rollout.
2. Make the Gateway's transactional admission, DB timestamps/period keys, plan dashboard, Odoo deferred outbox/retry and administrative billing displays agree on the single rule. Changing the UI alone is insufficient.
3. Regression tests: January/February, leap years, month ends, UTC boundary at 23:59:59.999 to 00:00:00, concurrent same-idempotency-key admissions, contract expiration at rollover, plan edits without credit reset, migration with nonzero existing usage, and POS no-surprise-replay policy.
4. Confirm deployment/rollback and backup evidence on a populated staging database before releasing. Until verified, describe the **implemented** rolling 30-day behavior accurately rather than claiming calendar reset.

**Evidence paths:** `src/lib/quota-cycle.ts`, `drizzle/0101_rolling_print_allowance.sql`, `src/lib/entitlements.ts`, `src/lib/print-job-service.ts`, `src/lib/manual-subscriptions.ts`. This section supersedes the unqualified policy assertion in BILL-02 as a *product decision*: BILL-02 documents the implementation as of its audit snapshot; the desired UTC calendar-month behavior remains unresolved.

### Verified regression reconciliation and security patch

On `main@172e85866bb9cb6ef84120450399fbe19dc74869`, the native UI suite logged 679 passes / 1 failure (CI `40592702785`). The one failing test expected a pending invitation list despite mocking a non-owner profile, contradicting the newly enforced owner-only API/UI contract. Keep its stale-response assertions but use an owner fixture; add an independent Full Access test to ensure no invitation read/render. The change preserves intentional denial rather than weakening permissions. Latest independent commit `433057118fb99574a7254a31e3c1319508ffc9a8` separately installs the SHA-256-pinned Ubuntu Brotli security patch; CI verification of that exact image/commit remains necessary. No physical-printing claim.

## 9. 2026-10-28 — BILL-CI-001: blocked-plan fixture vs active-contract expiry

**Baseline evidence**: `main@a93017eaeeefb2235b2174a5c50e410d644df0a0`, GitHub Actions CI run `40593133779`, App / Gateway integration job: 768 passed, 1 failed in `tests/billing-entitlement-access.test.ts` at the case “fails closed when billing configuration explicitly blocks entitlements”. `getTenantEntitlementLimit` returned `TenantSubscriptionRequiredError` instead of the test's expected `TenantEntitlementConfigError`.

**Root cause**: The fixture set `status: "active"` and `entitlementBlocked: true` but did not populate `currentPeriodEnd`. The shared live-contract predicate in `src/lib/entitlements.ts` deliberately rejects missing/expired contract dates **before** checking entitlement configuration. That ordering is security-correct and matches the separate regression test proving a missing end date cannot grant perpetual printing.

**Repair**: For this *specific* blocked-entitlement test, provide an explicit future contract end, keeping the real configuration block as the only reason for denial. Assert both the expected `TenantEntitlementConfigError` and that the correlated live-subscription predicate continues to exclude this blocked tenant. Preserve runtime predicates, subscription data and immutable migrations unchanged. The already-existing missing-expiry test remains intact. No auth/scanner/test gate was weakened.

**Verification**: The prior CI failure constitutes RED evidence. Record the *new commit*'s exact App / Gateway integration and quality gate outcome after GitHub Actions completes; until then verification is pending, not PASS. Physical printer tests were not run for this billing-test fix.


## 9. 2026-10-28 implementation slice: UTC calendar-month quota alignment

**Baseline:** `main@a93017eaeeefb2235b2174a5c50e410d644df0a0`. This entry supersedes Section 8's OPEN runtime-policy status once the new commit and its CI are verified; historical 0101 remains immutable.

- **Root cause:** The fixed-duration `date_bin(interval '30 days', ...)` computed an admission ledger key from first activation; the customer requirement is a UTC civil-month boundary. Subscription term and job admission windows were incorrectly conflated in service, admin, customer UI, and bilingual descriptions.
- **Unified ownership:** PostgreSQL `statement_timestamp() AT TIME ZONE 'UTC'` and `date_trunc('month', ...)` own the key. The Gateway's `reserveTenantPrintCredit` transaction owns atomic increment and idempotency. UI/API read the same key and next `interval '1 month'`. Odoo retains intent, local outbox and explicit no-surprise-replay for denied POS; Agent does not enforce credits.
- **Forward migration:** `0102_calendar_month_print_allowance.sql` (journal + latest no-DDL-change snapshot) preserves all 0101 rolling rows and seeds the current month with MAX previously consumed credits in overlapping rows. It never replays, erases or subtracts prints. This method avoids double-counting the same logical job in old calendar and rolling buckets, but can *overstate* partial-month consumption after old receipts are purged; release operators must reconcile disputes from retained evidence.
- **Automated regressions authored:** `tests/print-quota.test.ts` (calendar start/end and repeated, nondecreasing cutover carry); `tests/manual-subscriptions.integration.test.ts` (Dec/Jan UTC rollover, leap February, renewal isolation); immutable journal/source parity and latest snapshot tests; customer/admin bilingual copy. Local isolated SQL-builder test observed 2 RED before code and 2 GREEN afterward; this **is not** the PostgreSQL integration suite.
- **Release gates still pending:** Execute full GitHub CI on the exact commit; run fresh and populated PostgreSQL migration + rollback rehearsal; validate quota counters under concurrency and mid-boundary in deployed clock; Windows/physical printers remain unverified. Drain all old Gateway instances before migrating production. Do not claim production readiness on skipped CI jobs.
- **No changes to:** payment provider enablement, password-only authentication, ownership/Full Access permission matrix, physical print status, applied SQL hashes, real customer data, or security exception baseline.

**Other system risks retained:** AUD-001/SEC-001 require exact-current-commit run analysis; AUTH-INV-001 owner authority remains a product matrix gate (separate from the privacy fix); DATA-01 lacks DB RLS defense-in-depth; HW-001 remains BLOCKED without authorized real printers and Windows service environment. The source inventory is a file map, not a completed code review.

## 10. 2026-10-28 cross-component owner-invitation authority and Odoo quota language

**Relationship to previous section 9:** The calendar-month allowance in the current `main` is already implemented by `0102_calendar_month_print_allowance.sql` and `quotaCycleStartSql()`. This change deliberately does **not** overwrite its SQL, historical usage or tests. Release must follow the migration's explicit admissions-drained requirement; validated hardware/staging evidence remains outstanding.

**INV-OWNER-002 — fixed workspace owner vs global platform owner conflation:** A verified `tenant_users.role = 'owner'` with a live password-backed v2 session is the only tenant principal allowed to send/revoke invitations and to view pending recipients. The global `users.is_platform_owner` flag no longer substitutes for workspace ownership. Tenant row lock, session revocation fence, same-origin write protection, unexposed hashed tokens, invitee Full Access (`admin`), and no repeated password prompt are preserved. Team navigation, Team UI, Settings badge, and shared role label now consistently use the tenant role, without broadening platform administration or commercial rights. The UI's send/revoke early-return conditions explicitly deny non-owners.

**REGRESSION:** Workspace owner without platform flag can invite; platform admin whose membership is Full Access cannot invite or read pending emails; stale/revoked/unverified owner fails closed; role-free invite acceptance and origin protections are retained; owner and Full Access UI are distinguished; static source assertions updated to the new authority helper.

**ODOO-QUOTA-002:** Odoo customer-facing EN/AR quota messages and pending-reset dialog now describe the **UTC calendar month** rather than a fixed 30-day interval, consistent with Gateway current policy. This does not change Odoo's manual-reprint requirement for billing-denied POS and kitchen receipts or assert that physical paper printed.

**Verification ledger:** All source edits and tests were authored against live GitHub sources. Local execution is unavailable in the current environment; record exact GitHub Actions results for the eventual commit, and do not mark hardware, populated-database migration, Windows spooler or all-repository coverage as verified. If CI fails, keep the failure visible and trace its root cause rather than weakening quality gates.


### 2026-10-28 follow-up: monthly history and archived 30-day rows

**ISSUE BILL-HIST-001:** The Platform Admin workspace History renderer consumes `logicalUsageReport().monthlyHistory`. Its old SQL grouped every `print_monthly_usage.period_start`, so preserved 0101 rolling windows appeared next to new 0102 calendar windows as additional “months,” potentially duplicating entries. The source was the retained historical ledger, not a duplicate print admission.

**Correction:** Keep every historical row in PostgreSQL, but scope the monthly chart query to exactly aligned UTC month boundaries (`period_start = date_trunc('month',period_start)` and `period_end = period_start + interval '1 month'`). The operational today/month/year counters still use deduplicated live jobs and receipts. An integration test seeds a calendar bucket plus a rolling window overlapping it and expects one monthly record. Historical months with only archived rolling windows will be absent from the calendar chart; their ledger evidence remains in the DB. This does not certify historic calendar attribution when job timestamps have been purged.

**Verification:** source-level RED→GREEN assertion executed in isolation; PostgreSQL regression and full CI must run on the exact follow-up commit before release. No customer data, historical migrations, or print attempts were changed.
