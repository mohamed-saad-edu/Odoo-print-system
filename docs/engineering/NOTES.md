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


## Batch 2 — Odoo/Gateway partial-delivery reconciliation

**Finding (HIGH, source-confirmed):** Gateway status vocabulary has no persisted `partial` status. The Odoo read/reconciliation method `_apply_synced_status` nevertheless translated a received `partial` into `submitted`. For an already `claimed` or `printing` outbox job it could even return early without showing that output may have occurred. Gateway and the Odoo customer presenter classify partial delivery as uncertain; this path contradicted both and hid the manual-review warning.

**Correction:** Treat a legacy/foreign `partial` response as terminal `unknown`, prefix the diagnostic with `UNKNOWN_PARTIAL_DELIVERY`, retain its detail, and surface the existing manual-review audit. Do not automatically print again and do not claim physical output or map it to a valid Gateway status.

**Regression:** `tests/test_partial_gateway_status_reconciliation.py` invokes the actual production method via AST with controlled ORM boundaries, checking ambiguous delivery with and without a diagnostic. GitHub-only environment cannot run pytest locally; **NOT RUN** pending GitHub Actions on the exact commit. Existing tests already require `job_customer_state("partial") == "needs_review"`.

**Coverage:** `odoo_addons/print_gateway/models/print_job.py` PARTIAL; `tests/test_partial_gateway_status_reconciliation.py` AUTHORED. Other directories and hardware remain TODO/BLOCKED; no claim of full-repo completion.


## Batch 3 — cross-layer exact geometry printer identity

**Finding (MEDIUM/HIGH, source-confirmed):** Gateway's `validatePrinterGeometry` and Go's `validGeometryPrinterID` reject printer identities over 120 UTF-16 code units, control characters, or surrounding whitespace. Both Odoo Python and Odoo browser JS instead allowed up to 256 code points/units and did not reject whitespace/control in the printer identity; this admitted a geometry snapshot that native execution correctly rejects.

**Correction:** Require exact, non-trimmed printer identity with <=120 UTF-16 units and no C0/C1 controls across Odoo Python and browser JS. No printer fallback, default geometry or synthetic measurement was introduced. Keep actual ID strings and fingerprints unchanged.

**Regression:** Add six valid/invalid identity boundary vectors to `contracts/printer-geometry-fixtures.json`. The same fixture is exercised by Gateway Vitest (`tests/printer-geometry-contract.test.ts`), Go (`agent/internal/printer/geometry_contract_test.go`), Odoo browser Vitest (`tests/receipt-geometry-v3.test.ts`) and Odoo Python (`tests/test_odoo_receipt_geometry_v3.py`), including astral Unicode UTF-16 boundaries, whitespace and control characters.

**Verification:** Contract suites and cross-language execution **NOT RUN** locally; GitHub Actions on the exact commit required. Geometry files and shared test fixtures PARTIAL; all hardware and remaining modules TODO/BLOCKED.


## Batch 4 — workspace invitation authority in customer-facing EN/AR

**Finding (MEDIUM, source-confirmed):** Team and Settings copy told customers that only the **Platform Owner** could manage workspace invitations/membership. The real authorization guard `requireWorkspaceOwnerForInvites`, request routes and Team UI grant invite authority to a verified **Workspace Owner** and deny a Platform Owner who is merely a Full Access member. Misleading copy asked ordinary customers to contact the wrong party.

**Correction:** Change `team.membersDescription` and `settings.roleChangesImmediate` in English and Arabic to identify the *workspace owner* as invitation authority, distinguish Full Access operational permissions, and reserve plan/billing detail visibility to the workspace owner. No actual role/auth changes or repeated password prompts.

**Regression:** `tests/team-invitation-restoration.contract.test.ts` invokes `translate()` for both languages, asserts the owner distinction and Full Access copy alongside the existing route and session access tests. **NOT RUN** locally; verify via exact-commit GitHub Actions.

**Coverage:** `src/i18n/messages/en.ts`, `src/i18n/messages/ar.ts`, `tests/team-invitation-restoration.contract.test.ts` PARTIAL; all unreviewed components TODO. No source-level review is promoted to production-verified.

## 2026-10-28 — Desktop/Gateway Unicode diagnostic printer identity (GitHub-only)

**HIGH finding:** Desktop correctly serializes `encodeURIComponent(printerId)`, while Rust and Go CLI allowlists accepted only ASCII and rejected Arabic IDs or names with spaces before Gateway could authenticate the diagnostic.

**Change:** Validate a single canonical percent-encoded path segment in Rust and Go. Only the existing diagnostic routes/verbs, exact Agent credential, idempotency key and Gateway tenant/printer fence remain available. Reject traversal, encoded separators, malformed UTF-8, double-decoding, controls, query injection and oversized IDs; no other-printer fallback.

**Tests:** Rust native `printer_action_paths_are_strictly_scoped`, Go `TestAllowedGatewayConsolePath` and `TestPrinterDiagnosticPreservesEncodedIDAndOrigin`. Source-local test execution NOT RUN under GitHub-only constraint; confirm full CI on exact commit. Remaining modules stay TODO until reviewed; physical hardware NOT RUN.


## Batch 6 — Odoo v2 Unicode source-operation boundary

**State:** implementation committed; exact-commit tests NOT RUN (GitHub Actions runs cancelled by concurrent `main` updates).

**Root cause:** `src/lib/odoo-idempotency.ts::parseOdooIdentity` validates `sourceOperationId.length <= 200` in UTF-16 code units; Python `idempotency_namespace.py::wire_key(2,...)` validated `len(operation_id) <= 200` in Unicode code points. For 101 astral symbols, Python admitted the durable Odoo operation (101 points) while Gateway rejected its identifier (202 UTF-16 units). Repeating the same outbox operation would continue to receive an input error rather than ever entering the Gateway queue. No automatic physical retry is introduced by the fix.

**Regression-first commits:** `0ba3276827ec6385d28746b10f2b6efc090460ab` adds Python acceptance of 100 astral symbols, denial of 101 and immutable v1 acceptance; `041f6b200f177a1de58e956da0c385b2ff2beaf0` adds Gateway Node boundary parity.

**Implementation:** `9e919ca2cfb639a84bc2acb5410221f6c207eb90` counts UTF-16LE bytes in Python, rejects invalid Unicode and length over 400 bytes before persistence, does not touch stored v1/v2 digests or historic print rows. Source independently inspected. CI run `40600057383`: App/Quality, App/Gateway and Odoo19 cancelled; Agent/Go skipped. Docker, Windows Installer and Security/Resilience workflow reported success; those are not evidence of the target Python test. **RED/GREEN not observed in CI.**

**Coverage:** `src/lib/odoo-idempotency.ts`, `odoo_addons/print_gateway/idempotency_namespace.py`, `tests/test_s06_versioned_keys.py`, `tests/s06-identity-policy.node.test.mjs` inspected; all other directories remain TODO or BLOCKED until end-to-end review and exact-commit test proof.


## Batch 7 — exact opaque printer identities at print and Agent boundaries

**Baseline/source audit**: `main@6664628b8029829e6ec46db6b0f2058639cbdd91`, current runtime source sampled under `src/lib/print-job-service.ts`, both `src/app/api/print/jobs{,/v2}/route.ts`, `src/app/api/agent/heartbeat/route.ts`, `src/lib/printer-model.ts`, desktop IPC and native Agent identity validators. Inventory/registration and diagnostic printer names are distinct from immutable cloud execution IDs.

**Root cause (P1 wrong-printer risk):** Three independent admission paths silently called `.trim()` on a printer ID. The Odoo print endpoints applied Zod `z.string().trim()`, the transactional job service independently trimmed the ID before the tenant+printer lookup (including missing-owner receipt reconciliation), and the Agent heartbeat normalized observed IDs and explicit `privatePrinterIds` before applying inventory/sharing changes. A malformed padded ID could therefore select, update, or unshare a *different exact printer identity* when its trimmed version matched an existing row. This is invalid authority substitution, not a user-friendly label normalization.

**Regression authored first:** `c69892e2103701d87a77d14bb77c0aad152f8671` adds PostgreSQL-backed rejection across legacy/v2 Odoo POST and internal enqueue service, asserting no job was enqueued. `e72493cffff0dec8a2cc6e0e9a3e44f4ebdaafee` adds a real Agent heartbeat rejection and negative-sharing test, asserting a padded local ID never becomes an existing printer or changes its sharing state. RED not observed because Actions runs were cancelled by concurrent pushes; do not claim pass from test source.

**Root fix:** `39d72e2bbeaaf81237b16f9cd0957f0227baff51` introduces the browser/server-safe shared `isExactPrinterId` (nonempty, no leading/trailing whitespace or C0/C1 controls, maximum 120 UTF-8 bytes). `4836b009ba9309c027166c1795e4f87c2c54beef` rejects invalid IDs before job owner lookup; `ddc4fc7bed57ee9f0893a09692c62367fd463372` and `943ec885c7ad2d3ebd451f4033a33e50c4536757` apply the same rule to both Odoo POST APIs. `61e1b4e8c16e320d5b49ba89307625236913490e` validates exact observed IDs and explicit private/manager inventory IDs without changing already valid IDs; geometry remains bound to the precise observed ID. No data reset, auth bypass, reprint, migration or physical output claim.

**Verification:** exact-code/commit existence checked through GitHub API; GitHub Actions `40601330986` for heartbeat fix was cancelled (App/Quality, Gateway, Odoo and Go). Full PostgreSQL integration, real Windows service, physical receipt, idempotent retries and printer model lifecycle tests remain **NOT RUN/BLOCKED** until a complete exact-head CI job and authorized hardware/staging review. Keep the modules TODO; no manufactured DONE.


## Batch 8 — Odoo customer outcome and authoritative billing code evidence

**Status:** Source fix and regressions committed; exact-commit Odoo tests NOT RUN, due to CI concurrency cancellations.

**Finding P1 (stale file output):** `odoo_addons/print_gateway/customer_presentation.py` already guarded a `file_created` label against failed status, but its counterpart `not_created` still overrode explicit `unknown` and `partial` operation states. A stale local file marker was being presented as a deterministic negative output instead of uncertain. Regression test first (`7f12f995280374598e0b434edb3c99488a955af3`), then root fix (`d61992752c75c10d094b4015e9250645f0cca2ee`) limits not-created customer claims to deterministic status `failed`. Unknown and partial remain needs_review and cannot be auto-retried.

**Finding P1 (billing error code authority):** The same customer presenter classified an arbitrary free-text `UNKNOWN_...` substring before checking stable machine code `PRINT_QUOTA_EXCEEDED` or `TENANT_SUBSCRIPTION_REQUIRED`, falsely presenting an admission rejection as physical ambiguity and hiding translated next steps. Regression first (`2e2abdbbafe2e6ed60bf5e579ba47d5f09104146`) then fix (`440a75f3014ba5832095280dcbe6c6957490311c`) gives known quota and manual-subscription denial codes priority, retaining existing fallback for unknown codes and non-billing diagnostics. This changes presentation, never actual admission/retry decisions. Arabic/English translations remain in place.

**Test/CI evidence:** `tests/test_v4_odoo_customer_presentation.py` added parameterized contradictory-state cases and explicit untrusted-text collisions. CI `40601661798` Odoo19, Gateway, Quality and Go jobs were cancelled by concurrent newer pushes; no PASS claimed. Full staging acceptance, physical printers, migration replay and other TODO modules remain outstanding. Neither historical print rows nor migrations were changed.


## Batch 9 — Desktop complete-fleet pagination metadata (source-reviewed)

**Status:** source change `048b305c4d16ab2a89610ee1f115e46adaab7354`, regression `1efdf27b2d71daa6817a038929f7f319d4498e1f`; **CI App/Quality CANCELLED**, not PASS. `src/desktop/lib/ipc.ts` and `tests/desktop-fleet-pagination.test.ts` PARTIAL; related Gateway fleet read, Go CLI response headers and Rust IPC remain TODO pending complete execution proof.

**Finding:** Desktop `fetchGatewayFleet` used `headers?.["x-has-more"] !== "true"` as an unconditional success terminal. Explicit malformed metadata (`TRUE`, `1`, etc.) or a final page with contradictory continuation headers could hide part of a printer/Agent fleet without alerting the operator. Gateway publishes a strict `true|false` contract.

**Correction:** Reject malformed present flags and `false` pages carrying continuation cursor identity/timestamp; retain absent metadata for older unpaged paired-Agent CLI responses. Paginated `true` responses still require a valid advancing keyset. Regression uses the actual typed Tauri IPC flow with injected malformed response envelopes. No printer fallback, printing or DB mutations.

## Batch 10 — Desktop diagnostic admission localization (source-reviewed)

**Status:** source `31e74dc211135cb2f3019501f5533cf3b5371e04`, UI callsite `2e39fc4807a920c5175f7601803eb3aa077f97f5`, bilingual regression `c0c7906ce1af4f209d529ff3407bd4a9e3f9f4e9`; exact-commit CI **NOT RUN / pending**. Source areas `src/desktop/lib/printers.ts`, `src/desktop/main.tsx`, `tests/desktop-diagnostic-admission.test.ts` PARTIAL.

**Finding:** A diagnostic test-print receiving Gateway `PRINT_QUOTA_EXCEEDED` 429 displayed `friendlyPrinterError` generic hardware failure rather than the translated UTC-month credit notice. A `TENANT_SUBSCRIPTION_REQUIRED` 403 became a misleading permissions denial. Machine-readable API codes were already preserved on the IPC error but not used in the Desktop diagnostic presentation.

**Correction:** A pure locale-aware `friendlyDiagnosticAdmissionError` maps validated known printer, quota, rate/concurrency, and manual-subscription codes to existing EN/AR keys. Unknown/transport-ambiguous results continue to show `diagnostic.admissionUnknown`. The existing guarded `DiagnosticOperations` key lifecycle is untouched: no automatic reprint, no invented paper proof, no cross-printer fallback. Regression checks real translated outputs, no untrusted raw diagnostic leakage, and guarded UI wiring.

**Verification/coverage:** New Vitest was authored through GitHub API only. Tests, local Rust/Go, physical Windows hardware, and full populated-data migrations are **NOT RUN** until exact-commit jobs complete. Continuous concurrent updates to main have cancelled many earlier runs; workflow-level success with all source jobs skipped is not a full test PASS. Source-wide ledger remains TODO.
