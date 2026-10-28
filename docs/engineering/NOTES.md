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


## Batch 9 — reject malformed UTF-16 identity and padded retry keys

**Status:** Source fixes pushed to `main`; exact-commit application tests still NOT RUN while newer pushes cancel queued/in-progress jobs.

**P1 printer wire identity (malformed UTF-16):** JavaScript TextEncoder silently replaces an unpaired UTF-16 surrogate with the replacement glyph. This violates the exact opaque printer ID contract and may target a different Agent string. Regression first in `tests/exact-printer-id.test.ts` (`730341c272ef844b587aae4695bd6e598ade9e19`) covering Arabic, exact whitespace, control chars, 120-byte multibyte boundary and unpaired surrogate. Fix `7696c823457ab803789e8a11308dbbd0fecef460` uses `encodeURIComponent` to fail closed on malformed surrogates before UTF-8 byte measurement; no fallback to a different printer.

**P1 job-idempotency alias:** Both Odoo POST request validators previously used `z.string().trim()` on `idempotencyKey`. A malformed value `" key "` could silently equal a separate already-accepted operation `"key"`, returning a reused job and hiding caller identity mismatch. Regression first in `tests/print-idempotency.test.ts` (`39f6f70d1bbcdf54d077d346331d6fca547ae0ef`): an accepted operation remains uniquely recorded and padded keys are HTTP 400 on both routes rather than replay aliases. Pure `isExactIdempotencyKey` helper in `src/lib/idempotency.ts` (`22b1d427957f1e752bde4143b76a67740be3cc04`) shared by legacy POST (`10256b721a8bd6ed08e41cd6d330c02204a5f663`) and v2 POST (`e2624a950fa5d697029568b82878891b05690b39`); both reject outer whitespace and controls without normalizing identity. API schema docs synchronized in `ab5a4b64937b5389679470445964c1cb5691ca31`. These are forward-compatible input refusals, not data rewrites, retries or credential changes.

**Risk gates:** All 268 recorded directory modules in `MODULE_COVERAGE_LEDGER.md` remain TODO/BLOCKED until exact-source review and CI. No test has been disabled. Do not describe skipped/cancelled App/Gateway, App/Quality, Odoo or Go jobs as PASS. Real Windows printer and populated UTC calendar-month migration remain BLOCKED.


## Batch 11 — Windows native Agent sharing fixture against validated aliases

**Status:** CI failure reproduced in GitHub Actions logs; fixture correction `09ee74c7f79ec71a8c9b22a5003d5334a28fbd69` pushed, Windows/Go rerun pending. Test area `agent/internal/agent/printer_sharing_test.go` PARTIAL, actual printer and overall Windows build NOT RUN.

**Evidence:** `Build Windows Installer` run [40601446414](https://github.com/mohamed-saad-edu/Odoo-print-system/actions/runs/40601446414), native Windows Go step: `TestAgentSharingPrivateInventoryIncludesRuntimeDesiredAndScopedAliases` falsely expected a hard-coded `local~aaaaaaaa`; `TestAgentSharingRejectsClaimBeforePrintingAndAllowsStoredResultReplay` passed the forged alias into `testPrinterBinding` and panicked on missing exact config. Production `resolvePrinterAlias` now correctly checks Agent-scoped SHA256 prefix, so no arbitrary 8-hex suffix can select a printer.

**Correction:** Replace invented fake aliases in these two tests with `gatewayAliasPrinterID(local.ID, ag.cfg.Agent.ID)`, preserving native hash matching and a valid pre-dispatch denied sharing branch. Existing `printer_alias_contract_test.go` continues to assert forged alias hashes cannot resolve a backend. Do not loosen production or the claim fence to make legacy fixtures pass.

**Other Windows failures on that historic run:** `TestPDFPayloadRequiresEOFInFinal4096Bytes` failed prior to separate native PDF trailer work in later main. Reinspect exact current HEAD and run Native Windows Go before any completion claim. Source-wide module statuses remain TODO; concurrent main CI cancellations cannot be treated as successful tests.


## Batch 12 — private printer heartbeat Unicode and Windows alias waiter

**Evidence / root boundary:** Gateway `src/lib/exact-printer-id.ts` rejects IDs over 120 **UTF-8 bytes**, malformed surrogate/outer whitespace, whereas Go Agent `validGatewaySharingID` historically enforced 120 UTF-16 units. A 61-character Arabic private ID (122 bytes) could poison an entire heartbeat body and delay suppression of stale private printer inventory. JavaScript `String.trim()` also rejects an outer U+FEFF/BOM that Go `TrimSpace` did not. Exact identity must never be silently normalized. Windows native run `40602375610` (job `122533713751`) additionally proved a waiter-sharing regression used an invented `local~aaaaaaaa` alias; signed aliases are required before resolving a binding digest.

**Test-first / source commits:** `04f5e186b572af313dee648b0c3e8e2b782b4582` adds real Go UTF-8/heartbeat privacy regression, formatted `96cc7e3acfa6fb8389c2c4d6adc808efb07c7367`. Existing worker commits `28fe76d4d3...` and `f182ab70422...` adapted shared Go tests and corrected 120-byte validation. `6431c860ca83017c013868926988d3bebef24e5c` adds exact JavaScript BOM boundary regression; `6e19ee52ccf7184e1f075203e786c9bc5ff176ae` makes Go `TrimFunc` reject an outer BOM while allowing one inside the opaque identity. `35f099b6d5aec35e99e53b441074ab772025edc5` replaces forged Windows mutex waiter alias with `gatewayAliasPrinterID(local.ID, ag.cfg.Agent.ID)`, preserving runtime hash validation, unshare and claims.

**Verification status:** Test files committed, but queued/cancelled CI is NOT a Green phase. No local Go/Windows CLI invoked (GitHub-only requirement). Runtime Go, native Windows installer, full Odoo/PostgreSQL/browser acceptance and physical hardware remain NOT RUN until completed exact-SHA job evidence. TDD RED/GREEN execution was unavailable due GitHub Actions job backlog; do not claim it. These changes do not migrate, reset or modify customer data. Keep partial module coverage TODO/BLOCKED.


## 2026-10-28 — Withdrawn endpoint registration must not pretend success

**P1 customer trust / lifecycle authority — targeted source fix:** `src/app/api/printers/route.ts` correctly deduplicated by Agent-scoped physical execution endpoint, but its `matchingPhysicalPrinter` replay path returned HTTP 200 `already:true` even when the retained printer had lifecycle `disabled` or `retired`, or the local Agent explicitly revoked `shared_with_gateway`. The response implied a successful printer registration even though the original queue remained unavailable. No printer should be reactivated or exposed by merely repeating registration.

**Regression authored first:** `3169a4e7a62c8319f30b471e4749f1677f11dc96` adds PostgreSQL-backed cases in `tests/printer-endpoint-admin.integration.test.ts` for disabled/retired/unshared endpoints: exact duplicate POST must return HTTP 409 `PRINTER_ENDPOINT_CONFLICT`, leave one stored queue and preserve its lifecycle/denial flag. Existing active endpoint convergence remains covered by the pre-existing IPv6 and Windows spooler parallel-registration cases.

**Implementation:** `784ba2a8c50d60fa6f59cbad459abfc92f54c041` denies deduplicated POSTs when `matching.lifecycle !== "active"` or `matching.sharedWithGateway !== true`, retaining the preexisting protocol-conflict refusal and same JSON error envelope. The current registered ID, job history and printer-sharing policy remain unchanged; no delete, migration or automatic reprint is performed. This is a presentation/admission contract correction, not physical output verification.

**Verification:** Regression test source and production guard confirmed in GitHub. Exact fix commit GitHub Actions CI run [40603881144](https://github.com/mohamed-saad-edu/Odoo-print-system/actions/runs/40603881144) was QUEUED at observation; **RED/GREEN NOT RUN**. Mark these two files PARTIAL, the remaining 260+ directory entries TODO/BLOCKED, and native printing/staging backup-restore NOT RUN. The runtime must not be declared verified until a complete exact-source CI and physical test exist.


## Batch 13 — Gateway origin empty delimiters and userinfo

**Boundary:** `src/desktop/lib/ipc.ts` WebView URL normalization, `src-tauri/src/commands.rs` Rust native pairing/probe/config and `agent/internal/config/gateway_url.go` Go origin/endpoint parser must agree on a single uncredentialed HTTP(S) origin. The customer cannot see a successfully accepted Gateway URL that native Agent later refuses, nor have invalid raw userinfo silently normalized.

**Evidence:** Desktop previously tested `parsed.search || parsed.hash`. WHATWG URL getters give empty values for explicit `?` or `#` with no content; Go explicitly rejects ForceQuery and raw fragments and Rust checks presence using query()/fragment(). A second gap: Rust `username() == ""` and no password, and JS empty username/password, do not reliably detect an explicit empty `@` userinfo marker. Go rejects `u.User != nil` regardless of contents. Both cases would admit or normalize a different origin across the WebView and native boundary.

**Tests first / corrections:** `b430bc57f7cf2afed067565880715d84150e5d83` adds runtime Vitest test for exact empty-query/fragment markers, `51755efac724ffceeec0f25c28a0a101960fdca9` changes TypeScript to inspect serialized URL presence. `7f4ee0be6bc598334c2ead0e398d2f80b861a846` adds empty-userinfo Test to Vitest, `abd2e3546ac866d42da84aeea80e021e85863956` adds native Rust regression, and `b8da9b547fd72fe9666105ef128aa5982b97f633` extends native Go origin tests. `7754b05e3e90c378ebe69c7785d6a3ebdbcfb827` and `c05decfd3c6ced625cd0df3cc1536c9a4693f517` reject raw userinfo markers before TypeScript/Rust URL normalization. No remote HTTP or new scheme allowed; no customer data or configuration rewritten.

**Verification:** CI/native tests for exact commits are QUEUED at this note; **NOT RUN** is the only valid status. Do not claim pairing verified until full App/Quality, Rust Windows and Go jobs complete without cancellation. Security policy, password-only login, manual subscriptions, tenant isolation and physical outcome fences remain unchanged.


## 2026-10-28 — Manual plan operation key must fence cross-plan races

**P1 manual-billing consistency (source-confirmed)**: `src/app/api/platform/plans/route.ts` and `src/app/api/platform/plans/[id]/route.ts` both looked for a prior audit event by Platform Owner + action + `Idempotency-Key` but only serialized using an advisory lock keyed to each **plan ID**. Concurrent requests for two different IDs with the same operation key acquired different locks, both observed zero prior audit records, and could mutate two plans for one request identity. That violates explicit manual SaaS administration idempotency and makes retry reconciliation ambiguous. No Stripe or automatic activation is introduced.

**Regressions before implementation**: `eabad6593214b468421b904c27b79d1194ea1541` adds a PostgreSQL-backed concurrent create test: one 201 and one 409; exactly one inserted plan and one matching audit record. `31cbe1cfeffb6209122908c9d0cdce3847c9662a` adds the corresponding two-existing-plans PATCH test: one 200 and one 409, only one edited row/audit. Existing same-body retries remain supported.

**Fixes**: `107506972f269f2a572e3c63d365ecc8d4007015` (POST) and `29612766925215d52b6d42d27ddf7618b0b8b584` (PATCH) acquire a transaction-scoped advisory lock for Platform Owner ID + operation type + exact idempotency key **before** taking the existing resource-specific plan lock. Audit digest reconciliation is unchanged, so divergent payloads return the existing `IDEMPOTENCY_CONFLICT` class; matching retries reuse committed outcome. No plan prices, subscription state, quotas, historical audit rows or schema were changed.

**Verification**: Source and test changes are committed to `main`. RED/GREEN execution and full CI on one exact final SHA remain **NOT RUN / QUEUED** because GitHub Actions queues are saturated by concurrent commits. Retain TODO for `src/app/api/platform/plans` and `tests/manual-subscriptions.integration.test.ts` until application + PostgreSQL jobs complete. Physical Windows/Odoo printing, populated UTC-month migrations and restore are BLOCKED.


## Batch 14 — Desktop/Agent canonical URL and diagnostic BOM boundaries

**Contracts and reproducible source findings:**
- Go `agent/internal/config/gateway_url.go:parseServerOrigin` explicitly rejects `host:` and port zero; TS WHATWG URL and Rust `url::Url` normalize raw authority before their standard port checks. Empty/nonexistent ports must not silently alter the saved Gateway URL. New test-first Vitest `93fd8fb7ac4acbbbd89156599f27782adfcd80e6`; Rust `71b6b13f40ababb2d8e94399c1ade1f8f0600dde`; TS correction `89473e163675a15773a7b7a9e2e3c175bb8b4376`; Rust correction `a082c84db20d868ff2f5015be6cba1b908372682`. Existing Go rejects invalid ports. Valid default/non-default TLS, bracketed IPv6 and loopback test origins are retained.
- Gateway `isExactPrinterId` rejects leading/trailing U+FEFF (JavaScript trim), but both Go CLI and Tauri Rust percent-encoded printer-ID validators accepted escaped edge BOM. This can admit an identity at the Desktop/Agent boundary that Gateway rejects rather than treating it as a distinct exact opaque printer. Go regression `51c824863bd1882bc555e608b4d5f41fc2ba2189`; Rust regression `d4ec4a544a8d065b744d13dd2d666a73bf7fe864`; Go fix `04542dca63520247d146a1a2fb2a35bb7bda5aea`; Rust fix `babda8814faefc73764640272ddd249e1ca00e7f`. A BOM **inside** a valid ID remains permitted and unmodified; only outer padding rejected.

**Safety and verification:** Neither path expands diagnostic verb/route authority, changes Agent credentials, makes an unknown printer fallback, changes customer data or migration, or asserts physical paper from submission. Exact-SHA App/Quality, Go and native Windows/Rust tests were **QUEUED/NOT RUN** when recorded, so no PASS is asserted. Hardware, full Odoo/DB release gates and remaining module coverage remain TODO/BLOCKED. Concurrent updates to `main` have repeatedly caused pending GitHub CI runs and documentation CAS conflicts; never infer all-green from workflow-level status when actual jobs are skipped.


## Batch 16 — Agent console Jobs/Fleet filter query allowlists

**Source issue:** The Go paired-Agent CLI `isAllowedJobsPath` originally inspected `url.URL.Query()`, which silently drops malformed percent escapes and decodes escaped parameter-name aliases before authorization, and forgot to forbid absolute URI authority, empty query markers or bare `#` fragments. The Rust Desktop `valid_jobs_query` also accepted duplicate keys, malformed percent escapes and raw fragments. Fleet Go parsing already rejected invalid percent *values* but accepted escaped parameter-name aliases and empty delimiters. These are credential-bearing read-only routes; allowlist mismatches are denied rather than normalized.

**Test-first commits:** Go `a8d42dfcbf34d17051390fb37cb4a87652b90350`, `500bf663401abec8b625850bf2616009b64ca6cd`, `a3e01073115c6a55c8185bb2fbb1c829583cb3a0`, `af9bb44bb1c19728986d52838b482e00720dd5b7`; native Rust `332534d5d0b4f7530256d79f548d0830fc531a8c`. Positive tests preserve `search=receipt+%D8%A3`, escaped hash literals, and single well-formed filters; negative tests use malformed escapes, duplicate keys, encoded raw keys, empty separators and external URI authority.

**Production changes:** Go `330ea8661a7d933ca96de8bc101cb8fb73ae3de6` now uses error-reporting `url.ParseQuery` and rejects nonlocal authority/empty markers; Rust `1f09e3fe8016404399a8bb25dea47591ffa49dd9` checks duplicate names/escaped values/raw fragments; Go raw-key parity for Jobs `0faee03e6e28b84b5de6435d569857373e90b010` and Fleet `8c98f1aab0c6bbfddeb94e12d273f07d73c38931`; Go Fleet empty delimiter guard `db6949d2e522c78eede95f4edaaa0e21d287d911`.

**Verification:** GitHub API writes succeeded; relevant exact-SHA App/Quality and Go tests were QUEUED or CANCELLED at observation, not PASS. No local checkout, no deploy, no customer DB writes, and no change to the authenticated per-Agent authority or printer selection. The full Gateway/Odoo/Windows and physical proof gates remain open and all unrelated ledger modules remain TODO.


## Batch 17 — Jobs/Fleet query dot-runs versus API route traversal

**Source issue:** The Desktop Jobs search uses `URLSearchParams` and can send a legitimate `search=invoice..pdf`. Native Rust `gateway_agent_request` and Go `isAllowedGatewayConsolePath` originally rejected `..` across the whole URI, even when the only path was exactly `/api/jobs` or `/api/printers`. Both independently allowlist exact API route, method, and query keys, so path traversal defenses should inspect *route path* while treating query search/cursor bytes as data.

**Test-first:** Go real allowlist regression `b6c00fed5fc6881bb533e4f5d7a88ca5c0f4b4a0` for dotted Jobs search and Fleet cursor; Rust pure native path guard test `93268188f3aadc7265e7d60c81c36133f664e2ff` verifies dotted search permitted but actual route `../` and any raw backslash denied.

**Correction:** Go `6cdd987c654020bc0f6c94d768f7dcff2b6c15c3` checks dot-runs only before `?`, while preserving a full-string raw-backslash block. Rust `8aff4ddaf417791d6ed92bf86820ca507bf5c8e7` introduces `unsafe_gateway_route_path`, used by `gateway_agent_request`; it keeps exact `allowed_agent_gateway_path` authorization and the same raw-backslash refusal. No POST permissions expanded, no printer-selection changes, no DB/data mutations.

**Verification:** Exact-SHA Go test and Windows Rust build remain QUEUED / NOT RUN due GitHub Actions backlog and concurrent main updates. Do not claim PASS or physical printer acceptance; rest of ledger remains TODO.


## 2026-10-28 — Odoo reconciliation and routing identity batches

**Scope:** GitHub-only source review and regression authoring within `odoo_addons/print_gateway`. This is not a completed Odoo install/upgrade, physical-print test or all-source audit. The tracked Odoo modules in `MODULE_COVERAGE_LEDGER.md` retain **TODO** until individually reviewed and verified; no claim of a clean complete module.

| Issue / source | Root cause and invariant | Regression (test-first) | Implementation |
|---|---|---|---|
| ODOO-STATUS-BATCH-BOOL | `models/print_job.py:cron_sync_status` ignored a False `_apply_synced_status` decision from an apparently successful batch reply, and counted the operation as synchronized. A rejected identity/status is not accepted evidence. | `8c1a2c59987ed13763ac2f86bdb557f5ab3de872`: `tests/test_odoo_status_cron_budget.py` exact GET fallback on refused batch status | `7545eb745cf77ac02046359ce85c9dad6791041d`: treat False as failed batch reconciliation inside savepoint, then run the existing exact remote-job GET fallback. No physical resubmission. |
| ODOO-POS-REPRINT-BOOL | `models/pos_order.py` coerced any truthy RPC value with `bool(reprint)`; a malformed string `"false"` became an explicitly authorized key-less reprint with a newly randomized idempotency key. | `de7af77bd8c7918e1e9f88e305b6551d8a19abe4`: real-method AST regression checks non-boolean rejection in both POS action and router and valid booleans preserved | `7d8dc1a3af3bac6c0bf22e6e49705ce61045e1a5`: require exact Boolean at both boundaries, forward unchanged, localized Odoo Arabic message |
| ODOO-BINDING-DEST-CYCLE | `models/print_router.py:_persist_durable_job` rechecked a live binding's printer and company scope but not its logical Odoo destination/document type after selection and PDF/image rendering on an earlier transaction. A later reassignment could route the old business document to a different binding purpose. | `4dddb9253a504f389fb954afd9b596137abc06e2`: execute production persistence method against changed second-cursor destination and document type with no outbox job allowed | `737c97ea9cd49696618222ca13cf43f04c0d5459`: compare the fresh selected binding's exact `destination_ref` model/id and `document_type` to persisted route values; Arabic errors |
| ODOO-BINDING-REPORT-IDENTITY | Two QWeb report actions can share the same Odoo operational destination and `document_type`. Changing `binding.report_id` after route selection must not authorize the old report through the new binding. | `cde284b642db0cecce3f0aff0f14d3130d290477`: reject changed report, retain matched report success | `d33a05a20c7a038636101055ceed44b2f7784016`: compare exact report row when the original operation was report-bound; reportless deliberate diagnostics are unchanged. Arabic translation included |

**Verification limits:** Source and test commits were written through the connected GitHub API. Their exact-SHA push-triggered `CI`, `Docker`, `Build Windows Installer`, `Native Backport Safety`, `Static Security Gates` and `Security and Resilience Gates` runs were observed **CANCELLED** by newer concurrent `main` pushes. They are NOT PASS. The test-first RED observation and all local Python/Odoo, live PostgreSQL, Windows, physical printer, populated upgrade and web/POS browser checks are **NOT RUN** in this GitHub-only session. Preserve manual subscription admission, exact opaque IDs, explicit reprinting, Arabic/English messaging, tenant/company boundaries and no auto-retry on unknown output.

**Next required Odoo gates:** finish an exact-head unskipped Odoo Python + addon runtime test, with multi-company POS/report/branch and postcommit intent replay; inspect every remaining TODO Odoo module; test migration on a populated copy without resetting data; verify physical printer receipt evidence with an authorized Windows/IPP/USB test environment.


## 2026-10-28 — Odoo operation identity, duplicate inventory and stale automation intent

**Issue ODOO-OPKEY-FALSY:** `print_router._submit_route` used a truthiness fallback for optional idempotency keys: an explicitly supplied invalid `0`, `[]` or `{}` could turn into a fresh random key rather than being rejected by the strict `print_job.create_operation` gate. A transport replay with such malformed RPC input could therefore create another print attempt. Regression `fe3d8224743ca1b560b4adc15c880ca24397c4ea` exercises the actual router against invalid keys before persistence. Fix `301cbbe5baae6c7284138caa81744d10afc40419` refuses any explicitly non-string/malformed key before outbox creation while keeping the original Odoo `None`, `False`, `""` optional sentinels and preserving exact valid padded strings.

**Issue ODOO-INVENTORY-COLLISION:** The Odoo setup controller could show duplicate Agent/printer choices for the same opaque ID; the pre-dispatch `inventory_has_shared_printer` gate accepted the first active/shared match even if another row contradicted its ownership or sharing. Test `ecd763cda09f1033031b4055aae4dc077b311bf8` exercises real controller methods with identical/contradictory duplicate IDs, distinct printer IDs with identical human-readable names, and fallback sharing conflicts. Fix `6b587f053bfd1ae9e73a3ced46cec5eea456e79d` shares a canonical ID inventory deduplicator: retain one copy when content is identical, omit the whole ID on contradictory metadata; use this in both controller pickers and fallback permission proof. No fallback printer is silently selected.

**Issue ODOO-INTENT-STALE-RULE:** Queued automated intents already rechecked policy active/model/event/filter and source company, but an admin could edit a QWeb report, raw template, priority or explicitly bound printer without changing those fields. Recovering an earlier business event then interpreted it through that later rule. Test `0f102d06dc26e5561ae35fa2a22e9f102399ab6e` adds real method cases for a policy or its explicit binding whose `write_date` advanced after captured `intent.create_date`. Fix `347eb29a2ea48a5afb3f5a360fbf6bc94c490d14` marks such an intent skipped with the existing stable `PRINT_RULE_CHANGED` audit reason, without sending a job. This conservative check intentionally requires explicit operator review when a rule changes during a delayed queue. Implicitly resolved bindings still need independent snapshot/replay review.

**Source and verification status:** GitHub Contents/Git Data committed directly to `main`; current exact commit SHA must be used for CI. Intermediate per-commit six GitHub Actions workflow runs were generally **CANCELLED** by other concurrent pushes rather than failing tests; an unskipped full Odoo Python and native Odoo run is **NOT RUN** for these fixes, and no local Python commands were executed in this GitHub-only session. All unexamined `odoo_addons/print_gateway` directories remain `TODO` in `MODULE_COVERAGE_LEDGER.md`. Live multi-company/Odoo runtime, Windows/IPP/USB physical output, POS browser workflows, populated migrations and unknown-outcome replay require authorized separate acceptance; **NOT RUN**.

## Batch — Odoo billing RPC details validation (2026-10-28)

**Finding:** The browser dialog has two input paths: a parsed `GATEWAY_BILLING_LIMIT:` string and a direct `billing_limit` object from `dispatch_report_action`. The direct path bypassed the parser's entitlement allowlist, allowed inherited JavaScript property names such as `__proto__` to be mistaken for a plan entitlement, and called `.toLocaleString()` on absent `used`/`limit` values. A partial/untrusted RPC signal could therefore throw while rendering a definitive quota rejection, hiding the safe customer guidance.

**Fix:** Apply the same explicit entitlement allowlist on direct objects, only format finite nonnegative integer usage and positive integer limits, and keep existing local, translated labels. No new billing authority, admission policy, auto-retry, print state or printer fallback was added. **Regression:** `tests/v4-odoo-errors.test.ts` exercises the actual Odoo JS exports with an inherited-property entitlement and an incomplete direct signal. RED/GREEN execution is **NOT RUN** in this GitHub-only review; evaluate the exact commit's Vitest/CI result. This is one inspected UI edge, not signoff of the rest of the Odoo module.

## 2026-10-28 — Odoo Gateway strict-origin follow-up

- Root cause: `models/gateway_destination.py:canonical_origin` used false-y `urlparse` userinfo/query/fragment fields, so an empty `@`, `?`, or `#` delimiter could be interpreted as an authorized clean origin. Keep exact-origins clean before any credential-bearing Gateway transport.
- Test-first regression commit: `48af174a3e8d42e27db1cfb631b39258f68baf30` in `tests/test_gateway_destination_policy.py` rejects empty-delimiter variants.
- Production commit: `0524d634c65a590c92ba14802932243cb29148a7` rejects explicit raw `?`/`#` markers, empty netloc userinfo and any non-empty userinfo before canonicalization.
- Verification: GitHub API commits confirmed. RED and GREEN test commands were **NOT RUN** in this GitHub-only environment. Check exact-SHA CI before claiming PASS; live Odoo, migrated DB, POS, report and printer checks still NOT RUN. All outstanding module ledger TODO entries remain open.

## Batch — Gateway IPP/IPPS endpoint identity (2026-10-28)

**Root cause:** `physicalPrinterIdentityKey` synthesized `http://` for every network IPP observation, including the declared `protocol: "ipps"`. The same host+port+resource therefore had the *same* canonical identity as plain IPP, while a secure `ipps://` URI had a different identity. Heartbeat deduplication and manual registration consume this key and could incorrectly suppress a distinct TLS printer or report a protocol conflict. Fix the synthesized URI scheme to HTTPS for IPPS before normalization; preserve explicit URI resource case and both historical migration and job records. Regression in `tests/physical-printer-identity.test.ts` compares secure/insecure network observations and the explicit secure queue for both equality and rejection of unsafe reuse.

**Verification:** Source authored via GitHub API against main@6da85b0b901646618910988a5efb6b60b84f057d; exact-commit CI pending. No local Go/Node/Postgres runner or physical printer was used (**NOT RUN**). Unknown-outcome/reprint and tenant scoping behavior unchanged. Other modules remain TODO in the module coverage ledger.


## 2026-10-28 — Platform tenant directory and cross-tenant jobs: live read fencing

**Finding P1 (PLATFORM-DIRECTORY-READ-2026-10-28):** GET /api/platform/tenants and GET /api/platform/jobs checked the Platform Owner session before starting an independent cross-tenant SELECT. Owner demotion/session revocation after preflight could disclose workspace membership counts, commercial status, names and historical job metadata. The shared read-authority gate already exists in platform-auth.ts and the shared job-history service already accepts DbTx; both routes were missing their wiring.

**Fix:** Both endpoints now re-check the same owner, session family and password-version rows under shared transaction locks until their actual SELECT completes; no five-minute mutation password step-up, no credentials or payloads disclosed. Owner removal after preflight returns private no-store 401; unavailable storage yields 503; other request limits and history projections unchanged.

**Regression authored:** tests/platform-directory-live-authority.integration.test.ts exercises successful owner reads and a PostgreSQL blocked user-row UPDATE/commit race for both endpoints. **Status: SOURCE CHECK ONLY, NOT RUN** pending exact-SHA CI. Not a claim of RED/GREEN observed; remaining platform Stats cached/unfenced reads and database explorer remain TODO. No data resets, CI bypass, deployment or secrets changed.

## Batch — Desktop local/cloud printer collision fence (2026-10-28)

**Finding:** `mergePrinterInventories` merged local and cloud `PrinterInfo` rows by opaque ID alone, retaining cloud `agentId`, verification and other authority on an unrelated native/local queue. `eligibleGatewayTestPrinterIds` checked only the local privacy switch, so a shared local queue with an ID collision could enable a cloud test of a different endpoint. The Gateway returns agent-scoped cloud rows; this is a **Desktop presentation/permission consistency fence**, not evidence of an active cross-tenant breach.

**Fix:** Require matching native operational-verification binding digest, queue ID and Gateway logical key before blending rows; when missing/conflicting, display local evidence only. A cloud test also requires a valid, fresh local verification when the same local ID is present; private, candidate-only and duplicate local IDs fail closed. Preserve the remote-only and legitimate verified-local flows. Regression `tests/desktop-printer-sharing.test.ts` covers collisions, exact matches, private withdrawals and duplicate local identity. No printer registration, accepted job, output retry, DB schema or history was changed. Verification: exact-commit GitHub Actions pending; real Windows/IPP/USB hardware and local red/green execution **NOT RUN**.


## 2026-10-28 — Platform global statistics: live owner authority, cache, and usage snapshot

**Finding P1 (PLATFORM-STATS-OWNER-2026-10-28):** Global stats read cached aggregate values or performed a dozen independent SQL reads after a one-time owner preflight. Platform owner demotion after that preflight could leak cross-tenant commercial counts, queue history and integration totals; the cached path bypassed all transaction-time checks. Local billing usage and tenant detail used the same helper with a separate DB executor.

**Fix:** Acquire the existing canonical Platform Owner read authority in one Drizzle transaction before both cache lookup and fresh global aggregates; hold owner/session/password shared locks until snapshot response is composed. All aggregate and business/verification SQL now use that same transaction. logicalUsageReport accepts an optional DB transaction and tenant-detail forwards its existing transaction; standalone customers preserve the old call shape. No mutation step-up or subscription/printing business-policy changes.

**Tests authored:** tests/platform-stats-live-authority.integration.test.ts verifies source ordering, authorized stats JSON and a real PG owner-demotion race. **NOT RUN / CI pending** until exact-SHA result; do not claim RED-GREEN or successful concurrency gate. Populated migration, hardware and full suite remain BLOCKED/NOT RUN.

## Batch — exact Odoo batch-status operation identity (2026-10-28)

**Finding:** `POST /api/print/jobs/batch-status` used Zod `.trim()` on opaque job IDs. A caller could ask for `" accepted-id"` and silently receive another accepted operation, unlike `GET /api/print/jobs/v2`, which explicitly rejects normalized identities. Tenant/API key and Odoo installation scope still prevent unrelated-tenant disclosure; this is an *exact operation authority* mismatch, not evidence of cross-tenant access.

**Fix:** Use the existing opaque UTF-8 ID validator for every batch member, reject mixed valid/invalid batches in their entirety, and keep the batch and single-GET identity rules consistent. Regression `tests/batch-status.test.ts` exercises exact accepted IDs, leading/trailing spaces, C0/C1 controls, 121-character IDs, multibyte IDs over 120 bytes and mixed batches. Update `docs/SECURITY_INPUT_VALIDATION.md`. No data rewrite, migration, replay or changed billing authority.

**Verification:** Committed against main@974315c3b005ec6e12fe97c34df01675ffb6b9b5. GitHub-only source review; exact-SHA workflow and PostgreSQL regression outcomes must be collected. Local RED/GREEN, PostgreSQL and physical printer execution **NOT RUN**.


## 2026-10-28 — Platform database explorer owner-revocation fence

**Finding P1:** The read-only Platform Admin catalog and table explorer acquired a separate PostgreSQL connection after a one-time Platform Owner preflight; a concurrent owner revocation could commit before private cross-tenant catalog rows were returned. Sensitive columns were already excluded, but metadata and tenant/printer IDs still require live authorization.

**Fix:** The route now holds the existing canonical live-read authority (owner, session family and password-version locks) through the explorer's independently READ ONLY PoolClient transaction. A demoted owner receives a private 401 before catalog or row reads; a storage error remains 503. No SQL identifiers, allowlist or pagination rules were loosened. A second connection is temporarily held for this low-frequency admin operation; monitor pool pressure during acceptance.

**Regression authored:** tests/platform-database-route.test.ts checks denied post-preflight identity and guard-before-read ordering; tests/platform-database-live-authority.integration.test.ts exercises a blocked UPDATE/commit using real PostgreSQL. **Tests not executed here; Actions exact SHA pending**. Other platform read paths and hardware acceptance retain TODO/NOT RUN status.

## Batch — empty-userinfo IPP identity parity (2026-10-28)

**Finding:** The Go Agent validates `url.User != nil` for printer URL authorities, rejecting `ipp://@host/...` (empty userinfo). WHATWG `URL.username` and `.password` become empty for this input, so Gateway `validateIPPPrinterAddress`, discovery URI approval and `physicalPrinterIdentityKey` could silently accept/normalize a printer the Agent refuses to execute, or deduplicate it against a different configured URL. This is an authority/availability discrepancy; no confirmed physical misprint was observed.

**Fix:** Inspect the raw URI authority for `@` in all three Gateway boundaries, preserving permissible `@` elsewhere in the resource path. Keep existing private-address/port/security rules and existing printer histories unchanged. Regression `tests/printer-destination-security.test.ts` and `tests/physical-printer-identity.test.ts`: empty-userinfo rejected for IPP and IPPS, never used for deduplication. Exact-SHA CI and hardware tests **NOT RUN** until workflow evidence; no local Go/Postgres runner in this GitHub-only review.


## 2026-10-28 — POS kitchen replay identity and Arabic print-safety boundary

### Batch ODOO-POS-KITCHEN-KEY (high priority)
- Root cause: `route_kitchen_print` hashed `pos.order.write_date` into the fallback idempotency key when `operation_id` was absent. A routine order sync/payment update could produce a new physical kitchen operation for an identical rendered ticket after an RPC response was lost; this violates the no-duplicate/no-ambiguous-auto-retry rule.
- **Test-first source:** `f61b383a87ffa35bf977cb8b06838d747b2db4d6` changed `tests/test_kitchen_idempotency_fallback.py` to require identical fallback key across write_date-only changes, distinct keys for changed rendered images, and the documented key derivation.
- **Implementation:** `7e3d1036a1e5769a89876877bea1387f51a0aa9f` hashes the validated base64 ticket data, not mutable `write_date`, alongside exact order/binding/preparation destination; explicit operator/caller keys and deliberate reprint behavior are unchanged.
- Ruling: A genuine independent kitchen print with identical raster requires a fresh explicit operation ID. It must not be inferred from incidental metadata changes; the POS browser already mints per-operation identities. Cost: legacy keyless extensions must provide a fresh key for a second copy with identical raster.

### Batch ODOO-POS-EXPLICIT-KEY (high priority)
- Root cause: the strict `_submit_route` operation-key validator introduced earlier could be bypassed by three POS router entry points that used `if not idempotency_key` first. Malformed explicit values like integer 0, empty dictionaries, or empty lists became `absent` and were replaced with deterministic keys before reaching the durable outbox, making the caller's intended identity untrustworthy.
- **Test-first source:** `05144f32bed8c2e5e65405c83f83fab70421f5a5` (`tests/test_odoo_pos_operation_key_guards.py`) tests actual receipt, kitchen and Sale Details router methods with malformed identities, plus preserved `None`/`False`/`""` Odoo empty sentinels.
- **Implementation:** `6743d842d3462c3c27906ec5c244ce3c6b0f7e3c` rejects invalid explicit identities before routing, rendering or outbox writes. No new fallback destination, printer, or retry authority.

### Batch ODOO-ARABIC-PRINT-ERRORS (medium priority)
- Root cause: a source/catalog spot check found five translatable fail-closed messages without `msgid` entries in `i18n/ar.po`. These covered malformed operation keys, printer/agent identities and temporary Gateway admission limits; Arabic users would see English where print admission failed.
- **Test-first sources:** `6e9d7077d768d6751255e78f55b199d4e9c354b5` and `e01bc08edbc2d73425f28579f87c4f968b85e8bd` (`tests/test_odoo_print_safety_translation.py`).
- **Implementation sources:** `d265bc0c193bc9aebd7f1ab70dec556b3644dccf` and `76cf4e2aabd91b2bbf4a146ab932b4d27b5a4ffc` provide one Arabic `msgstr` per exact English source message.
- Static source/catalog spot checks confirmed all five exact `msgid`/Arabic `msgstr` pairs exist. These checks are **not** equivalent to running the full Odoo translation extractor, native Odoo Arabic user test or UI screenshots.

**Verification/coverage:** All listed commits were accepted by the connected GitHub API on `main`. Their pushed commit CI runs were often **CANCELLED** by subsequent concurrent pushes. No offline Python, JS, Odoo or physical-printer tests were executed in this GitHub-only session; classify **NOT RUN**, never PASS. `MODULE_COVERAGE_LEDGER.md` Odoo TODO rows remain open until full native addon, migration, multi-company, POS/raster and printer verification. Do not deploy or reset customer data from this review.

## Batch — Odoo exact read after incomplete status batch (2026-10-28)

**Finding:** Odoo's `cron_sync_status` immediately called `_mark_gateway_job_missing` when the Gateway's authenticated batch-status response omitted a requested job. A batch response is documented as an *authorized subset*, not an explicit per-ID 404; a transient/incomplete response could irreversibly mark an accepted, still-running Odoo operation `unknown` without checking its exact current status. This is not permission to resubmit a job or infer zero paper.

**Fix:** Treat any omitted ID as ambiguous batch evidence. Use the existing read-only, exact-ID `action_sync_status()` lookup under per-job savepoint and scheduler budget; only its actual 404 invokes `_mark_gateway_job_missing`. A successful GET reconciles the current status, while failures remain eligible for later polling and **never trigger a physical POST**. Regressions in `tests/test_odoo_status_cron_budget.py` cover full omission followed by GET 200 and actual GET 404, with no automatic replay, and `tests/test_status_sync_savepoint_round3.py` now asserts 404 marking lives only under the per-job GET savepoint. GitHub-only source review on main@5afef7faeb91b2be3299f657a561eb007e03e9d0, CI and real Odoo/PostgreSQL **NOT RUN** until exact-commit results.


## 2026-10-28 — Account session inventory: live transaction-bound identity

**Finding P1:** GET /api/auth/sessions and GET /api/platform/auth/sessions validated a session before returning per-account inventory including IP addresses, user agents, tenant labels and current session families, but the inventory password and list queries ran as separate unfenced reads. Revoked ownership, suspended workspaces or changed passwords could race preflight and expose session metadata after revocation.

**Fix:** listOwnSessions optionally executes its account credential and inventory selects within the caller's authorized DbTx. Platform and workspace GET routes hold canonical live-session and tenant/user guards through the same transaction; revocation mutations remain untouched. Stale authority responds privately rather than leaking a session list. No MFA or authentication relaxation.

**Regression authored:** tests/session-inventory-live-authority.integration.test.ts covers guard ordering, authorized session list, real PostgreSQL owner-removal and tenant-suspension races. **NOT RUN / CI pending**; no assertion of test pass until actual output. Other modules, hardware and migration remain TODO/BLOCKED.

## Batch — Windows native Go red CI: correct legacy spooler and UTF-8 geometry fixtures (2026-10-28)

**Observed RED:** [Windows CI run 40613824791](https://github.com/mohamed-saad-edu/Odoo-print-system/actions/runs/40613824791) on main@e1e775b9eb0cd3014692d7ac949b25fcfb1213e6 failed native Go race tests in the Windows printer package: `TestQuickDiscoveryMustFenceTwoDistinctSpoolerQueuesWithSameLegacyID` (fixture precondition) and `TestGeometrySharedContractFixtures/identity-at-exact-120-utf16-boundary` (fixture marked oversized UTF-8 printer ID as valid). These were preexisting test/source contract inconsistencies, not changes to Go production dispatch made by e1e775b9.

**Fix:** The collision fixture now constructs current strong IDs to prove distinct physical queues remain distinct, then *explicitly assigns the same historic `StableIDFromSpooler` ID* to both saved and observed queues to test fail-closed legacy-upgrade quarantine. Current `StableIDForDevice` is unchanged. The shared geometry fixture's exact-120-positive uses 30 emoji (120 UTF-8 bytes), while its over-boundary negative uses 31 (124 bytes), in agreement with the Gateway and Go Agent's 120-byte opaque identity contract; names now say UTF-8 bytes, not UTF-16 units. Other cases/history and production validation remain unchanged. CI rerun on the resulting exact commit is required; hardware/installed Odoo **NOT RUN**.


## 2026-10-28 — Desktop duplicate cloud printer IDs and stale diagnostic authorization

**Finding P1:** Desktop fleet pagination validated page/cursor progression but accepted repeated opaque Agent/printer IDs within and across pages. The UI built a Map keyed by ID and could overwrite a different physical printer/Agent or silently choose a route. Diagnostic eligibility likewise did not reject duplicate cloud IDs. Failed cloud refresh could keep an earlier cloud snapshot eligible while Gateway health was still connected.

**Fix:** Reject repeated ID from either feed at fleet pagination, and independently exclude any conflicting cloud ID from UI merge and diagnostic print eligibility. A failed cloud refresh clears only cloud rows, preserving independently observed local inventory. Never choose a printer by array order, name or accidental fallback. No replays, schema/data changes or deployment.

**Regressions authored:** tests/desktop-fleet-pagination.test.ts covers identical/conflicting within-page and cross-page duplicates; tests/desktop-printer-sharing.test.ts checks safe local preservation and denial of ambiguous cloud test print. **NOT RUN** until actual Actions/physical evidence. Native hardware acceptance still BLOCKED.

## Batch — Desktop helper fast-forward rebase correction (2026-10-28)

**Source-integrity finding:** The concurrently rebased Desktop printer authority patch at main@a4dc77e4 retained two calls to `sameLocalCloudPrinterBinding` but omitted its declaration, causing an unresolved TypeScript identifier. **Fix:** Restore the narrow, local/Gateway cryptographic binding-digest comparator before its two call sites without changing any tenant/printer fallback or broadening authority. Add an explicit regression for missing native proof in `tests/desktop-printer-sharing.test.ts`; existing positive/mismatch cases remain. The Windows or Gateway printer hardware was not operated. The source edit alone is not a passing build: rerun TypeScript/CI on this commit and record the real result.

## Batch — TypeScript exact-ID validators and Docker source compilation (2026-10-28)

**RED evidence:** [Docker CI run 40614749699](https://github.com/mohamed-saad-edu/Odoo-print-system/actions/runs/40614749699) on main@e4e6b25965df24fd96d676ea0d575aedaaaf50d9 failed Next.js TypeScript checking in the `POST /api/print/jobs` image build. The failure was `TS2339: Property length does not exist on type never` on both job-id and idempotency-key rejected branches in `src/app/api/print/jobs/route.ts` and `src/app/api/print/jobs/v2/route.ts`; the same log also recorded missing `sameLocalCloudPrinterBinding` in Desktop (separately restored in 4ba18e5e). In both validators, TypeScript's `value is string` type guard claimed a malformed value must be a non-string, so rejecting a statically known string narrowed it to `never`. The actual validator behavior never changed.

**Fix:** Add string/unknown overload signatures to each validator: `string → boolean` for already-typed query parameters (so invalid branch is a usable string), and `unknown → value is string` for safe parsing. Preserve byte lengths, controls, Unicode and whitespace rules and the fail-closed HTTP 400 responses; no route-level unsafe coercion. Add explicit typed-string regression cases to `tests/exact-printer-id.test.ts` and `tests/idempotency-wire-identity.test.ts`. No Docker security gate disabled. Exact-commit image compilation/CI GREEN is pending and must not be inferred from source edits.

## Batch — ambiguous persisted physical-printer dedupe must fail closed (2026-10-28)

**Finding:** `matchingPhysicalPrinter` used `rows.find()` and returned the first physical endpoint match, even if two stored IDs represented the *same* execution destination. Registration and discovery provisioning could thereby silently adopt an arbitrary existing row, including a different owner-withdrawal/lifecycle policy; a manager edit could overlook ambiguous duplicate records. Tenant and Agent SQL filters remained present; this was a multiple-identity choice bug, not a claim of a demonstrated wrong-tenant print.

**Fix:** Return `null` for two or more matches, `undefined` for no match, and the exact row only when unique. Explicitly deny ambiguous identity in registration and discovery provisioning, and treat both one conflicting sibling and duplicate ambiguous siblings as conflicts in manager edits. Existing rows, historical IDs and receipts remain untouched, so the owner must explicitly reconcile duplicates. Regression `tests/physical-printer-identity.test.ts` verifies order-independent ambiguity, exclusions, no match and the three caller gates. No automatic printer fallback, data migration or reprint introduced. Exact-commit CI still pending; hardware and live DB acceptance **NOT RUN**.

## CI repair — formatter and regex text false positive (2026-10-28)

**Exact failure evidence:** main@0d301035bda45664e6f82b81dea1e155a83463c5, CI run 40616115289: Agent / Go job 122579860699 failed the existing `gofmt -l` gate on six recently added printer contract tests; App / Quality job 122579860790 failed its source path-alias scan because an unrelated email assertion `toMatch(/@/)` contained the raw forbidden character pair in a regex literal.

**Changes:** Apply only the formatting deltas emitted by that Go job (no test semantics changed), and retain the same email assertion through `toContain("@")` without the false-positive pattern. CI path-alias detection remains enabled and unchanged; no test, scanner or security check was relaxed. Those six printer tests continue to assert identity and collision protections. **Verification:** exact new-commit Actions results must be gathered; no local Go or TS test executor was used.

## Production v1 idempotency admission — 2026-10-28

**P1 root cause:** `POST /api/print/jobs` had a production escape hatch (`YASEIR_REQUIRE_IDEMPOTENCY_KEY=0`) that accepted print submissions without a stable logical operation key. A client retry after a transport timeout would then create another job and could print twice, contrary to the no-ambiguous-replay invariant.

**Fix:** Enforce the key unconditionally in production, regardless of that historical environment variable; remove the misleading Docker Compose override and update API/environment documentation. Development/test compatibility remains available for explicit legacy coverage only. **Regression:** `tests/print-idempotency.test.ts` now exercises the actual production route with the old opt-out set to 0, verifies 400/no row, and verifies a keyed retry reuses the same job. No schema migration, data reset, printer fallback, authorization weakening or scanner bypass. **Verification:** exact new SHA PostgreSQL/CI must complete; GitHub-only authoring does not execute local tests.


## 2026-10-28 — Odoo report native-fallback integrity (follow-up)

**Finding ODOO-REPORT-FALLBACK-001 (HIGH):** The browser report interceptor checked only `has_binding` to reopen native PDF. A contradictory RPC response (`has_binding=false`, `dispatched=true`) was therefore treated as safe native fallback, potentially duplicating a report already submitted to the Gateway.

**Boundary/ruling:** Odoo owns business binding selection, Gateway owns physical execution. Native PDF may resume only on a *consistent* explicit `has_binding=false, dispatched=false` reply with no success, error, billing hold or ambiguous status. Unknown/inconsistent replies stay bound to the original operation identity and require Print Activity inspection. Do not change a previously submitted print to `not_printed`.

**Change:** `097e6041c91d738ed3b09b00d98b3f9c453aa376` guards the actual `report_interceptor.js` registry route and updates `tests/current-run-report.node.test.mjs` with contradictory and partial RPC responses, sticky warning and exact operation-key replay. Arabic translation is catalogued in `odoo_addons/print_gateway/i18n/ar.po` in this follow-up.

**Verification:** GitHub Actions for this SHA were pending when authored. Real Odoo/browser/physical-printer tests NOT RUN; no staging or deployment. Other module TODO entries remain and should not be marked DONE before per-SHA test evidence.

## Gateway v1/v2 explicit print-expiry validation — 2026-10-28

**P1 root cause:** The two Odoo print POST routes duplicated a permissive `parseExpiresAt` helper that returned `undefined` for an explicitly empty string, making the service replace that caller-supplied deadline with its default. JavaScript `Date` parsing also accepted timezone-less, normalized/nonexistent dates contrary to the documented ISO contract. This could extend a stale logical print operation and split the two endpoints' future behavior.

**Fix:** Use one strict, timezone-qualified ISO datetime parser for v1/v2. Only the truly omitted field receives the database-clock default. Retain transactional TTL/future bounds in `createPrintJobForPrinter` and the existing idempotency/tenant/printer authority fences. **Regressions:** `tests/print-expiration.test.ts` (valid offsets/leap day, invalid dates/blank/naive), `tests/print-idempotency.test.ts` (both real route handlers reject malformed explicit timestamps without inserting a job). **Verification:** GitHub Actions exact commit pending; tests are authored, **NOT RUN** here.

## Desktop authenticated Gateway error data boundary — 2026-10-28

**P1 finding:** `src/desktop/lib/ipc.ts` created `Error.message` from a returned Gateway `error`/`message`/`reason` string or a short raw non-JSON body. HTTP and proxy failures can contain SQL, credentials or local paths. The error adapter also accepted fractional, negative, and non-finite quota counters, which could corrupt translated UI limit presentations.

**Fix:** Preserve safe locally authored HTTP fallback messages and keep structured machine `code`/`entitlement`/`upgradeRequired` fields for localized interpretation; never make untrusted body text customer copy. Accept quota counters only when finite safe integers (positive limit and nonnegative used; `unlimited` remains valid). **Regression:** the real code is loaded through the dependency-free VM harness in `tests/audit-desktop-gateway-offline.test.mjs`, checking secret redaction, status/code preservation, impossible numbers and valid counters. No changes to print safety/physical outcome classification, tenant authority, native key transport, scanners or locale resources. Exact-commit CI still **NOT RUN** until the jobs complete.


## 2026-10-28 — Cross-layer source audit: report RPC integrity and authenticated home

**ODOO-REPORT-002 (HIGH; `196f84daafe7edce82e54ba41bebab8186a59799`):** The Odoo report browser trusted truthy nonboolean `dispatched`/`success` values and displayed raw `res.message`/`res.error` from RPC in operator notifications. The new guard accepts only exact booleans, retains uncertain operation identities, and sends only localized/known-code remediation. `tests/current-run-report.node.test.mjs` exercises the actual registration handler with bad flags and hostile SQL/secret-bearing responses; mocked RPC boundary only. **Native/browser/full CI: NOT RUN / incomplete** on its original SHA, which was superseded by subsequent pushes.

**GW-HOME-LINT-001 (MEDIUM; `c9ff1f169d8c7f4900226e384d4cce117c27d264`):** GitHub CI App / Quality failed on an actual `react-hooks/error-boundaries` diagnostic: `<AuthenticatedHome>` and `<PublicHome>` JSX returned from a `try/catch` in `src/app/page.tsx`. Corrected the error boundary: transaction/data projection happens inside async error handling, authorization failures return `null`, and JSX is constructed only after the catch exits. `tests/authenticated-home-current-authority.contract.test.ts` covers the boundary while retaining tenant/session lock ordering and the public fallback. **Regression added but not directly executed via GitHub API**; full run for this exact SHA was cancelled as newer main pushes arrived. Windows installer and native security workflows independently reported success for this SHA; this is not evidence for the full CI suite.

**Verification policy:** No physical printer, populated upgrade, local Go/TS/Python test command or runtime browser was executed in this GitHub-only session. Keep both modules TODO until exact-version CI and end-to-end evidence are available. No deployment or data mutation.

## Odoo strict quota 429 proof — 2026-10-28

**P1 root cause:** The Odoo submit loop treated a typed `PRINT_QUOTA_EXCEEDED` 429 as definitive non-admission even if its `limit`/`used` fields were invalid. Python `bool` is an `int`, floats can be truncated, and `int(float('inf'))` raises unexpectedly. An intermediary response is not proof that an already accepted print did not reach hardware.

**Fix:** Only exact positive int32 `limit` and nonnegative int32 `used` counters, together with the exact quota code/entitlement/boolean, may establish the structured billing refusal. Untrusted malformed 429s take the existing `UNKNOWN_SUBMISSION_OUTCOME` recovery path and never auto-retry. **Regression:** extend the real AST-backed Odoo submission harness in `tests/test_kitchen_durable_outcomes.py` to cover booleans, infinity, NaN, decimals, strings, negative/zero and overflow counters. Exact new commit CI **NOT RUN** until workflow completes; real physical printer acceptance remains BLOCKED. No source data, migration, role, scanner or customer test was disabled.

## Agent pairing audit must match registration state — 2026-10-28

**P1 finding:** `createAgentForManager` logged `agent.paired` immediately after generating an unconsumed pairing code. At that point the Agent was only an offline, pending record and had no runtime credential. The real `POST /api/agent/register` handshake consumed the code and stored a secret but wrote no `agent.paired` event, so both success and failure audit evidence were misleading.

**Fix:** The creation event is now `agent.pairing_code_issued` (best-effort historical behavior retained). The real registration writes `agent.paired` with actor `agent` in the SAME successful PostgreSQL transaction as the hashed credential and consumed pairing code, without ever persisting the secret. If the transaction rolls back, the success event also rolls back. **Regression:** `tests/agent-registration.test.ts` asserts an approved handshake has exactly one paired audit row and a subscription-denied handshake has none; `tests/agent-audit-contract.test.ts` guards event vocabulary and transactional ordering. Exact new commit CI **NOT RUN** until results complete. No Agent credentials, migration, tenant role or printer state were changed.


## 2026-10-28 — Odoo structured capacity and ambiguous billing marker audit

**ODOO-CAPACITY-CODE-001 (MEDIUM; `619bb88a7614140a0fef0fa80c61e1f989a33a39`):** `gatewayServerMessage` previously did not recognize the canonical 429 `TENANT_ENTITLEMENT_EXCEEDED` machine code, even though Gateway returns it for rate/concurrency safety. `TENANT_ENTITLEMENT_UNAVAILABLE` also fell through instead of displaying the blocked-contract remedy. The fix uses the allowlisted `entitlement` field to distinguish technical throughput, concurrency and device capacity from the independent monthly `PRINT_QUOTA_EXCEEDED` allowance, and reuses existing Arabic/English gettext messages. `tests/v4-odoo-errors.test.ts` now checks all these categories, malformed entitlement keys and a contradictory `UNKNOWN_SUBMISSION_OUTCOME` traceback.

**ODOO-QUOTA-EVIDENCE-002 (HIGH; `7e85bc454ae544ab349c631bcfdd9063629c61ed`):** Embedded JSON `GATEWAY_BILLING_LIMIT:` or a direct RPC `billing_limit` object could be treated as definite pre-admission rejection even while a higher-priority stable code explicitly stated `UNKNOWN_SUBMISSION_OUTCOME`. This could falsely tell an operator a potentially printed receipt was never printed. Both entry points now reject conflicting stable machine codes, unknown/forged billing marker codes, and a quota-code/entitlement mismatch while retaining older valid legacy marker shapes. `tests/v4-odoo-errors.test.ts` covers these adversarial and accepted cases.

**CI evidence at read time for `7e85bc45...`:** Docker `40618333787` SUCCESS, Security and Resilience Gates `40618333824` SUCCESS, Native Backport Safety `40618333769` SUCCESS. CI `40618333690`, Static Security Gates `40618333745`, Build Windows Installer `40618333658`: CANCELLED due later main pushes, not PASS. `npm test`, Odoo browser/Python runtime, Go race, Windows physical hardware and populated database upgrade were **NOT RUN** in this GitHub-only audit. No deployment, data reset, tests or security gate disabled.

## CI-quality fixture corrections — 2026-10-28

**Observed RED:** App / Quality run `40618444733`, job `122586591586` at code-bearing `335517b5e2bf823ec8174d1542ea96035c6be0e3`, failed 25 cases. Two source-contract failures were fixture drift, not production regressions. The `tests/session-resource-repair.test.mjs` stub `ActionError` discarded the third `code` argument even as the test asserted `INVALID_REQUEST`; the real Server Action passed that code and still rejected bad IDs before lookup. The printer aggregate test searched for `inventoryPresent}` immediately closed, while the production SQL (correctly) includes `inventoryPresent} = true` in the count filter.

**Fix:** Preserve `code` on the mock ActionError, and anchor the stats contract on the full affirmative inventory predicate while continuing to check printer online/busy/error/unknown separately from Agent reachability. No production auth, spooler, status, quota, tenant or scanner behavior changed. **Verification:** new SHA full CI NOT RUN until completion; other ~23 App / Quality failures from the same old run remain independently TODO and are not claimed fixed by this patch.

## CI follow-up — missing Node VM external dependencies, not relaxed runtime guards

**Observed failure:** `main@335517b5e2bf823ec8174d1542ea96035c6be0e3`, CI `40618444733`, App / Quality job `122586591586`: the three `tests/continuation-credential-idempotency.node.test.mjs` HTTP tests failed at module link time because `../../../../lib/print-expiration` was not provided to their isolated VM, after the v1/v2 expiration parser was unified. Six `tests/continuation-odoo-activation-revision.node.test.mjs` PATCH tests likewise failed to link because their route newly imports `../../../../lib/manager-mutation-authorization` for GET. No test ran far enough to exercise the intended admission/activation assertions.

**Fix:** Extend the two offline VM dependency fixtures with narrowly scoped stubs, asserting that the HTTP replay test's expiration is genuinely omitted. Production `parsePrintExpiration`, `requireManagerActorInTransaction`, all transaction locks and fail-closed code are unchanged. The true parser and live session/DB paths retain their independent unit and PostgreSQL integration tests. **Verification:** these are regression-harness repairs; new commit exact-SHA CI must complete before PASS. Remaining unrelated App / Quality failures are still TODO; no scanner or test was disabled.

## Odoo quota-429 contradictory evidence — safe retry fence

**P1 root cause:** The existing precise-int32 guard still accepted a claimed `PRINT_QUOTA_EXCEEDED` even if `used < limit`, or if the response explicitly carried `remaining > 0` or `retryable=true`. Those fields contradict the canonical Gateway exhausted-monthly-quota signal and could let a proxy response misclassify an ambiguously accepted physical job as safely rejected.

**Fix:** Require `used >= limit` (including valid plan-downgrade overage). Validate optional `remaining` exactly zero and `retryable` exactly false when supplied, while preserving omission compatibility for older Gateway variants. Contradictory 429s take the existing unknown/manual-inspection path without automatic printing. **Regression:** add 6 actual Odoo submit-loop cases for contradictory numeric/boolean/string fields in `tests/test_kitchen_durable_outcomes.py`, while preserving the real exhausted quota test. **Verification:** current-commit CI and installed Odoo/hardware are NOT RUN until observed. No migration, authorization, scanner or historical print records changed.

## App/Quality native-VM importer regressions — strict printer identity retained

**RED evidence:** `main@a97488b31831896011a4e5a4f65dcbcb24dd578a` CI `40619577011`, App / Quality job `122590440230`: three Gateway HTTP regression cases could not load because their mocked `z.string().min().max()` chain did not implement the production Zod `.refine` step; five Desktop diagnostic cases could not load `conflictingCloudPrinterIds` from the actual Desktop printer admission module. These are harness failures and must not be misreported as passing actual authorization tests.

**Fix:** Extend the Node VM's minimal Zod boundary with a no-op refinement only for its already-valid HTTP fixture (real strict ID guards have independent integration/unit coverage). Execute the production `conflictingCloudPrinterIds` and `sameLocalCloudPrinterBinding` helper alongside `eligibleGatewayTestPrinterIds` instead of inventing a permissive helper; add a regression requiring that duplicate cloud queue IDs never authorize a Desktop diagnostic print. No production code, data, roles or scanners changed. **Verification:** tests are authored, run exact new commit CI; Windows hardware and installed Odoo tests remain NOT RUN.

## Platform tenant-detail error boundary — 401 after concurrent owner revocation

**P1 reproduced in CI:** `main@335517b5e2bf823ec8174d1542ea96035c6be0e3`, App / Gateway run `40618444733`, job `122586591567`: 955 PostgreSQL integration tests passed and one failed. The owner-revocation race for `GET /api/platform/tenants/[id]` threw `PlatformUnauthorizedError` out of the handler instead of returning HTTP 401. Root cause: `return db.transaction(async ...)` was inside a `try/catch` without `await`, so the rejection occurred after the function left its catch boundary. Live owner checks correctly denied access; only the HTTP error projection was broken.

**Fix:** `return await db.transaction(...)` keeps errors within the existing `manualApiError` response mapper. Transactional owner/session locks, tenant-private data projections and no-store headers remain unchanged. **Regression:** the same failing `tests/platform-confidential-read-race.integration.test.ts` case now also asserts the stable `UNAUTHORIZED` body for tenantDetail. Verification: exact new commit PostgreSQL integration CI pending; no local test executed, no authorization weakening, printer replay or data change.


## 2026-10-28 — Agent-health pagination and POS printer/output safety batch

**GW-AGENT-PAGE-001 — confirmed HIGH root bug (`8eceeb683dabfe760d01a5f6ce63244b758da934`).** `GET /api/agents/health?limit=...` computed `hasMore = page.length > limit` but called `getAllAgentsHealth(..., limit, ...)`; the page could never contain the extra row, hiding the entire fleet after page one. Fetch exactly `limit + 1` with max 200 allowed rows (service clamps to 201), preserve the transaction's `requireActiveTenantInTransaction` and `requireManagerActorInTransaction` guards. Add a route regression for next-offset and last page; update the native contract for the transaction argument. **No claims of a passing PostgreSQL integration test.**

**NODE-HARNESS-001 — CI failure root evidence.** GitHub run `40619577011` / App / Quality job `122590440230` failed native Node tests on its exact older commit; test harnesses imported a newer real module without supplying `print-expiration`, `apiMessageKey`, transaction guard, or Node VM `TextEncoder`. `a97488b31831896011a4e5a4f65dcbcb24dd578a` links actual pure parsers and updates the locked SSR contract; `993f1343bc91d8a92f8090737b11c8efa42d4397` provides the real UTF-8 encoder and asserts the new live diagnostic transaction. Do not reinterpret a test harness crash as evidence the production safety guard is broken.

**ODOO-KITCHEN-RETRY-001 — HIGH safety contract (`65dcab27b4cc045996b2b985c1bd2b12403beac0`).** Legacy native fixture supplied only `status=failed`, expecting a RetryPrintPopup. Odoo now correctly requires explicit durable `can_retry=true` evidence of non-printing; arbitrary failed/unknown physical attempts must not be retried. Update the known-safe fixture and add negative runtime coverage that an ambiguous failure cannot open retry, consume preparation change, or physically resubmit.

**ODOO-VERIFY-001 — HIGH identity isolation (`1e08fea3ef3858e81b8f925f59c4cd17dc4d687e`).** The shared Odoo picker test helper incorrectly labeled every physical printer's operational verification as `identity_strength=queue`. The real verifier rejects network/USB ESC/POS or IPP devices claiming a Windows spooler queue. Align fixture proofs with `windows_queue=queue`, `ipp_attributes/pdf_output=service`, `usb_interface/snmp_printer=device`; regress forged queue proof.

**ODOO-POS-NOTICE-001 — MEDIUM privacy/localization and HIGH ambiguity safety (`2d7f5066255d572db9143c9b028fefc25f41c996`).** Receipt and kitchen UI rendered raw `result.message`, including arbitrary RPC/server diagnostics, on accepted, rejected, file and unexpected paths; a contradictory `code=UNKNOWN_SUBMISSION_OUTCOME` with `status=failed,can_retry=true` could also close the identity as definitely rejected. Replace customer copy with the existing safe `gatewayServerMessage` code presenter and fixed `_t` translations, and keep explicitly unknown physical markers non-terminal even if a flag claims retryable. Add a source-contract/localized presenter regression.

**CI at `2d7f5066...` during audit:** Windows Installer `40620403356` SUCCESS; Security and Resilience `40620403352` SUCCESS. CI `40620403345`, Docker `40620403184`, Native Backport `40620403489`, Static Security `40620403242`: incomplete or pending; **NOT PASS**. Later GitHub CI results may supersede this observation. Entire source tree was enumerated, not line-by-line audited; per-directory TODO records remain open. No local commands, live PostgreSQL upgrades, installed Odoo, Windows spooler, physical paper test or deployment were run.

## Odoo/Gateway v2 canonical company-id namespace parity

**P1 root cause:** Gateway `parseOdooIdentity` accepts `sourceCompanyId` only as canonical positive decimal ASCII (`^[1-9][0-9]{0,17}$`), but Odoo's v2 `idempotency_namespace.py::wire_key` called `str(company_id)` without checking it. Invalid or padded IDs would generate an immutable local outbox identity the Gateway could never accept, stranding a print operation and creating migration/replay pressure. The normal runtime path uses `res.company.id` integers, but reusable ID derivation needs a matching fail-closed contract for restored/legacy/manual data too.

**Fix:** Validate exactly the Gateway's canonical decimal company ID before hashing v2 keys; leave historical v1 bytes and key derivation completely unchanged. **Regression:** `tests/test_s06_versioned_keys.py` covers zero, leading zeros, plus/minus/whitespace, non-ASCII digits, overlong IDs, bool and null, valid 1..18-digit IDs, integer/string parity, and v1 historical stability. **Verification:** source/test authored GitHub-only; exact new SHA Python/installed Odoo and Gateway Actions pending, physical printer NOT RUN. No data update or automatic reprint.

## Discovery snapshot GET — CI fixture recovered under transactional authority (2026-10-28)

**Observed RED on exact `main@a2eb9e05669bbea9b3c7e079b58f10315ae66330`:** All other relevant GitHub Actions workflows succeeded (Docker, Windows, Security/Resilience, Static Security, Native Backport). CI run `40620710991` passed Gateway, Odoo, and Go jobs; App / Quality failed ONE case `GET discovery exposes a matching fingerprint sourced from committed row` (`tests/discovery-verify-snapshot-f014.test.mjs:103`), HTTP 503 instead of 200. Root cause: production `GET /api/agents/[id]/discovery/[discoveryId]` now (correctly) reads `tx.query.discoverySessions` and `tx.query.discoveredDevices` under current Manager authority. The VM fixture had those methods only on the unfenced `db.query` object; `tx.query` lacked them and threw, leading to the safe 503 handler.

**Fix:** Add transaction-scoped, tenant/agent/session-predicate-aware session and device mocks; make unscoped reads throw to detect future regression. Add negative cases for revoked Manager family and a foreign-tenant device, requiring no discovery fingerprint leak. No production route, ACL, printer-sharing, idempotency, or scanner change. **Verification:** exact new SHA App / Quality and whole CI NOT RUN until GitHub completes; physical Windows/IPP/USB paper output remains BLOCKED.

## Agent false IPP/PDF capability advertisement — cross-layer transport invariant

**P1 source finding:** `agent/internal/printer/capability.go::SupportedProtocolsForDevice` returned `[pdf]` for every `ipp`/`ipps` *protocol label*, including `connection=usb/lpr/unknown/pdf_output`. Yet `PayloadCompatibleForDevice` (and Gateway's `validatePayloadForPrinter`) deny the same route because no physical IPP backend exists. The Agent publishes this derived `supported_protocols` list to heartbeat inventory, producing misleading customer/Odoo selections and non-routable requests.

**Fix:** Before deriving PDF from an IPP protocol, require the same physical admission predicate already used for dispatch (`PayloadCompatibleForDevice("pdf", "", d)`). No new backend is inferred and known IPP, IPPS, and network IPP paths remain supported. **Regressions:** exhaustive Go advertised-capability-vs-admission matrix over common transport/protocol combinations, explicit invalid IPP tokens and valid IPP transports in `agent/internal/printer/capability_transport_test.go`. Exact new SHA Agent / Go CI NOT RUN until observed; no native printer/hardware output acceptance here. No tenant access, persisted data or telemetry claims changed.

## Gateway UI printer-language badges must match actual physical admission

**P1 UX/route consistency finding:** `getPrinterLanguageBadges` added ZPL/TSPL/RAW/ESC-POS chips based on the protocol field alone. A USB, LPR, serial or IPP transport labelled with a byte protocol could be described as printable even though `validatePayloadForPrinter` strictly rejects that transport; similarly `raw` on a Windows spooler was shown as a RAW capability despite no approved passthrough declaration. The UI capability chip could mislead binding decisions and later surface impossible print submissions.

**Fix:** Derive visible chips only when the exact payload/protocol combination passes the same Gateway print-admission matrix, with no implicit operator capabilities supplied. Retain spooler/IPP PDF document baseline, USB RAW, TCP/9100 RAW, and existing valid ZPL/TSPL/ESC-POS badges. **Regression:** `tests/printer-language-badges.test.ts` adds false-label cases spanning unknown, LPR, serial, Bluetooth, IPP, spooler and USB with valid transport controls. No server print policy, data, quota, tenant or scanner changed; exact commit CI **NOT RUN** pending results, Windows hardware still BLOCKED.

## Odoo 429 legacy rate-code replay ambiguity — producer/consumer contract

**P1 replay root cause:** Odoo `PrintGatewayJob._submit_durable_job` treated any HTTP 429 JSON containing only `code=RATE_LIMIT_EXCEEDED` as a definite pre-admission refusal, scheduled a new POST and described the operation as safely queued. A repository-wide producer search found no Gateway print route emitting that code; the live Gateway uses `TENANT_ENTITLEMENT_EXCEEDED` with exact `max_jobs_per_minute` or `max_concurrent_jobs`, typed `limit`/`used`, `retryable=true` and `upgradeRequired=false`. A proxy may return a generic 429 *after* Gateway accepted a physical job, so the legacy code is not proof of non-admission.

**Fix:** Remove generic `RATE_LIMIT_EXCEEDED` auto-resubmission. Preserve unknown/manual-reconciliation semantics for every unclassified 429. Require exact positive int32 `limit` and `used >= limit`, plus no contradictory positive remaining credits, before interpreting canonical technical-capacity denials as safe bounded retries. Keep existing quota `PRINT_QUOTA_EXCEEDED` and genuine technical safety caps distinct, historical operation key unchanged. **Regression:** `tests/test_odoo_rate_limit_retry_budget.py` exercises valid typed burst backoff (including 25/100 prior attempts), rejects generic rate JSON, bad counters and conflicting remaining credits; `tests/test_kitchen_durable_outcomes.py` keeps durable kitchen job UNKNOWN for a generic 429. **Verification:** GitHub Python/Odoo CI on exact new SHA required, hardware NOT RUN.


## 2026-10-28 — GitHub-only cross-layer continuation: clock, quota, SSR, discovery and localization

**Source baseline:** inspected the current `main` through the GitHub connector only. The module and file ledgers remain TODO for directories whose implementations or tests were not actually inspected. Local code execution, staging migration and physical printing were NOT RUN.

| Finding | Root cause and invariant | Fix commit | Verification state |
|---|---|---|---|
| CLOCK-ADMISSION-UTC | Raw PostgreSQL UTC-naive `clock_timestamp()` strings used the Gateway host timezone for job expiry and timestamps | `372fb8510523140bcbfbe40c9e7b58f2ebf3dfb0`; shared `parseDbTimeMs` plus unit contract | Pushed; exact-sha workflow result required |
| BILL-UTC-BOUNDARY | Quota reservation and persisted job creation sampled different instants, risking charges to the wrong UTC month across midnight | `c75821869d8217d14df1eaae3e048c1f2c6b4d43`; one DB instant for quota cycle and created_at; PostgreSQL boundary test | Pushed; populated DB test not independently run |
| PRICING-AUTH-SSR | Public pricing's authenticated redirect queried the tenant's subscription outside the current session/membership transaction, unlike Home/Billing | `22569f45b09ae55dab69413a98d79e1ca23df0be`; tenant+actor locks, drop stale claims, preserve public catalog | Pushed; regression source contract, CI pending |
| DISCOVERY-NATIVE-HEADERS | Native discovery VM stub dropped NextResponse cache headers, giving a false 200-body contract failure despite correct production `private,no-store` | `752a04112ea3d6595df313f7e5d83082d367a5b9`; propagate headers, pin successful private GET | Prior App/Quality 716/717 tests passed, failure reproduced; follow-up CI pending |
| ERROR-I18N | PRINTER_OFFLINE's 503 fell back to generic service outage; printer verification/owner and suspended-workspace codes fell back to generic HTTP guidance | This batch: stable code mappings and Arabic/English safe operator copy | Source and contract regressions added; CI pending |

**Evidence limits:** GitHub Actions previously reported an App/Quality failure in the native discovery test from the dropped cache-control header; this batch repairs the test harness without removing production guards. No local test, physical printer, Windows spooler, installed Odoo or populated production database acceptance was performed. Do not mark those PASS.


## 2026-10-28 — Current Odoo App / Quality red run, fixture/identity audit

- **Evidence:** `main@cd958eee7955de898377b01a792484a6568d1a7b` inherits a failed Odoo Python contract stage from GitHub Actions `40633862657` / App / Quality `122637848771`: 88 failed, 1523 passed. Names and stack traces identify Python AST test harnesses executing real methods without importing their production top-level `is_exact_gateway_printer_id`, `is_exact_gateway_job_id`, or `_exact_pos_printer_id` dependencies. These produce `NameError` rather than exercising the intended admission guard.
- **Ruling:** Fix only the detached AST test environments by loading the actual unmodified helpers. Do not change or bypass production authorization, printer/Agent identity or job idempotency semantics to make fixtures pass.
- **Malformed identity vectors:** Several test files stored literal doubled backslash escape sequences (e.g. a backslash plus `u` and hexadecimal digits) while asserting rejection of actual Unicode BOM, C0/C1 controls, and lone surrogates. The Gateway permits an ordinary literal backslash as an opaque ID character; replace malformed test inputs with the intended Python escapes, not a divergence in Odoo's policy.
- **Additional fixture fixes:** Compile the real POS top-level selector with its two RPCs; use the kitchen harness's actual `ValidationError` class; accept both single-line and multiline gettext wrappers in source-language assertions.
- **Verification:** CI was RED before this batch. This is a GitHub-only test-harness patch; RED→GREEN, actual Odoo deployment, PostgreSQL runtime and paper verification remain **NOT RUN / CI pending** at commit time. Other independent failures (status polling fairness, policy AST guards, etc.) remain TODO until reproduced separately.


### P1 — 2026-10-28 rejected batch status must never leak a partial trusted map

- **RED evidence:** GitHub App / Quality job `122637848771` (`40633862657`), `tests/test_odoo_status_cron_budget.py::test_corrupt_batch_status_falls_back_to_exact_individual_lookups` failed on four cases. For a duplicate, foreign, padded or malformed remote ID, response validation raised `ValueError` but left the mutable `returned` dict containing earlier rows; cron applied earlier rows from a rejected response and issued only one exact-ID GET instead of two.
- **Fix:** `models/print_job.py::cron_sync_status` discards the entire map (`returned = None`) on *any* malformed or failed bulk response. Its existing per-job fallback must independently read each exact original job; the current red behavioral test already asserts both GETs and no unauthorized receipt.
- **Scope:** No automatic POST/reprint, no physical success inference, and no change to the supported 100-job selection window. Production fix committed directly on main; green CI **pending**, Odoo install/paper **NOT RUN**.
