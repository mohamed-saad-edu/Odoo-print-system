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
