# NOTES.md — Yaseir Cloud Printing full-repository engineering coverage

Source: `main@33e544e9ffb5abb82debd6a0860b700ab427e4fb`. Re-scanned **1967 tracked files** in **89 directory groups** through GitHub's complete recursive tree (`truncated=false`). This is a coverage index, **not** a claim of line-by-line audit. This file is root-level, outside the Gateway/Agent/Odoo/Desktop product trees.

**Status semantics:** `TODO` = path enumerated, code/read/verification incomplete; `DONE` = code, cross-contract and exact-commit CI tests reviewed; `BLOCKED` = cannot verify as text through GitHub API or requires real hardware/staging. These are independent of existing per-file ledger statuses. Every path stays TODO/BLOCKED until evidence is linked; counts do not imply production readiness.

## Verified source observations and work batches

| Batch | Scope / root cause | Change / regression | Evidence | Status |
|---|---|---|---|---|
| Known billing fixture, 0102 UTC month, shared admin effective subscription, role-owner invitations, Arabic/English quota errors | Repo already contains fixes; confirm against exact main SHA | Tests in billing, manual subscriptions and invitations; immutable 0102 migration preserved | Recent main commits; current full CI not yet green | TODO |
| HIST-01 tenant collision | Receipt archived for tenant A hidden by live job with same id in tenant B | `b3cc2704177351104e564c9f1ba8c8a021a59e7a`; real DB test `tests/job-history-tenant-collision.integration.test.ts` | Commit pushed; CI superseded/cancelled | TODO |
| GEO-01 stale configured profile | Agent cached configured geometry survived profile removal | `258c1a7da29f2df3c151b44d622ba0ec88c05256`; `tests/printer-geometry-contract.test.ts` | Commit pushed; exact CI pending | TODO |
| HIST-02 unknown markers | SQL LIKE `_` wildcards mismatched JS literal startsWith() | `17e08a46d2869ea0a31412e583ce4bbe70ce891f`; DB test for real/lookalike marker | Commit pushed; exact CI pending | TODO |
| HIST-STATS-03 cross-tenant dashboard collision | Platform 24h totals suppressed tenant A's receipt when tenant B had a live job with the same opaque ID | `327b97d240bbfa2f8073edd55a604971480d9170` changes the exact tenant predicate; PostgreSQL regressions in `tests/platform-stats.test.ts` cover cross-tenant inclusion and same-tenant dedup | Windows / Security & Resilience / Native Backport PASS on exact SHA; CI / Docker / Static Security CANCELLED when new pushes superseded this run | TODO |
| INPUT-PLATFORM-01 malformed fleet paging | Platform Owner inventory treated scientific/empty/fractional offset and limit tokens as valid by `Number()` coercion | `a39455104e18de51360c3bd4131c91acd563073b`: bounded exact decimal parsing and authenticated PostgreSQL route regression | Windows / Security & Resilience / Native Backport PASS on exact SHA; CI / Docker / Static Security CANCELLED during concurrent push activity | TODO |
| PRINTER-IPP-ROOT-01 wrong queue identity | Gateway and Go identity folded explicit root URI into `/ipp/print`, although the endpoints can address different IPP queues | `12c6ca3d39a888ec12c27e8b27c9f5d63eec247a`; formatting follow-up `d9a24f171860fc009fc863bb850d4765e5c36689`; TypeScript + native Go regressions for root, empty path, default queue and hardware identity | Exact-SHA CI unfinished or cancelled by concurrent pushes; physical printer execution NOT RUN | TODO |
| PRINTER-IPP-ROOT-02 native transport alignment | Legacy Go `normalizeIPPURL` silently rewrote explicit root to `/ipp/print`, and `PrinterBindingDigest` merged separate queues despite new stable-ID guards | Guarded GitHub commits: `5959e1ffe90116d5aa9da01235af95582893225d` (native transport), `c15806bb600c282618d4d993e2178ce378d00058` (binding digest), `58c06d38ffef49e41a00ebb31d71ae32cbd6f0c1` (privacy regression), `94321050aee470ea9913b641c3a162cd44503f46` (registry regression). Preserves `/ipp/print` fallback for bare hosts. | Exact-SHA CI results were queued/in progress or cancelled as later commits superseded; real physical IPP hardware NOT RUN | TODO |
| PRINTER-IPP-ROOT-03 scheme-less shortcut identity | Gateway originally hashed `192.168.1.20:631` as the root queue while native IPP executable shorthand targets `/ipp/print` | `35e4350a6b2629b972e29a3f5e3e574b824b7042`, `255906fc7caf51c77be82cbfe85564f1959783fb`, parser-safe follow-up `e809f20de529f981e472f703c4000805c0f1545e`; regression preserves root queue distinction, exact default and rejects malformed shortcut path | Final SHA CI still queued/in-progress, physical printer NOT RUN | TODO |
| INPUT-HEALTH-2026-10-28 | Agent-health pagination coerced non-decimal values; authenticated diagnostics lacked non-cacheable headers | `12fd6d16cb80e0c3acb37e739c0459532c51666c` test-first, `b8420ef5387b6ad4c61afc667ec49f913c7e23e1` parser, `f4a1f806d43ce2ab4fb839801876f9059a5408d9` cache test, `83e61db6dc89a9e316f1ee799454bd1dcd4ac049` response cache policy | Source fixed and regression authored; exact-SHA CI queued or cancelled, NOT VERIFIED | TODO |
| INPUT-PLANS-2026-10-28 | Plan quotas and ordering accepted booleans/scientific-string JSON via `Number()` | `a1746df9c5b3687257341ddf083df315be4b9797` negative tests; `52a3df673e1ae6b92f35087bb41e1c8b80f2940c` type-only integer parsing; `a5ec57212960b1c4f8bd4dca32a49be923031ce3` null/absent order distinction | Source fixed; exact-SHA CI queued, PostgreSQL and prod NOT RUN | TODO |
| PLATFORM-ACTOR-STATE-2026-10-28 | Revoked Platform Owner could see 404/409 installation/key existence or inactive state before live transaction actor revalidation | `19c6760c8b2eb5ef93d65d11d06ece500ea7113f` test-first; `70f2e2e7478521a0ef73fa5a96a7e40d20c31e2f` revoke and `fc560fad4aa923a5e9951d9c5da5adb8d94709bb` quarantine move actor check before state response, retaining original resource-lock order | Exact-SHA CI queued, runtime RED/GREEN NOT VERIFIED | TODO |
| PLATFORM-PLAN-FORM-2026-10-28 | Admin form accepted IDs and commercial values outside the authoritative plan parser, causing post-reauth submission errors | `5c03f8054bbc8248d61452768bdff7d5e870e661` test-first; `06b10889230300c94650a0203bd28d86690f0e2e` HTML ID/quota/order/price-format constraints | Exact-SHA CI cancelled/superseded; backend remains final price-size authority | TODO |
| SUBSCRIPTIONS-PAGING-2026-10-28 | Platform Admin only rendered first 300 subscriptions; status was filtered in browser after the 300-row truncation, silently hiding other customer contracts | `76a35da8ea1b9806cf63cceb26bfb4fbf1374275` PostgreSQL test-first; `dfeef0972e1036af4ebcc5efbe6b6624de98288b` SQL status filtering with stable pagination; `f96a56a563d275f693d1c7ee54b4e4aecd4d0904` UI contract test; `95af283801aa52014e451b7c63bbcd394c0c0994` localized paging UI | Exact-SHA CI cancelled on next concurrent main push; PostgreSQL regression NOT RUN in this GitHub-only session | TODO |
| PLAN-PRICE-BOUNDARY-2026-10-28 | Platform Admin accepted a syntactically valid but >INT32 minor-unit advertised price until after password confirmation, while backend rejected it | `14d48c3fdf1ce6d1d7fd219436919604043b7df4` test-first; `431bb15dc0d782c127873316e5e1bd60fc733241` shared exact parser; `8d6c6fc787f58a0e4890f482a46024a3893c1a97` backend reuse; `0be9d83b8d3d0848ef99e15891dfdd0975414ab9` / `68460fce0db0eec81f0b10779ffc078fa72c3467` localized errors; `ff39b1de2bf91a93297824d7c9ce64341f58b5bd` client pre-confirmation guard | Tests authored but exact GitHub CI pending/cancelled; no local/physical verification | TODO |
| ODOO-HTTP500-2026-10-28 | Native Odoo test still demanded automatic queued retry for unclassified HTTP 500 despite possible post-admission physical output; operator guidance omitted the Print Activity path | `f6381ed41a505da6e0a454d2511ae90a603cf402` real-addon regression updated to assert UNKNOWN/no retry/no duplicate HTTP POST; `bd3409d3517b0bf685ff5bedfc558fcd15a006b0` localized safe operator message; `c8ca9a2b7bf616150ba8b37b4c26232d49458a50` Arabic translation | Historical native Odoo CI failure `40602721665` confirms old expectation mismatch; current exact-SHA CI CANCELLED/SUPERSEDED, installed-addon RED/GREEN NOT RUN, physical printing NOT VERIFIED | TODO |
| PLATFORM-COMMERCIAL-READ-FENCE-2026-10-28 | Platform subscription, request and private pricing GETs checked owner before SQL but could disclose data after a session/principal revocation race | `98d2ebf8b8b87c86c154246f51ca85346ad5bab8` SQL contract test; `653025433c7be02bee7b66a58e53c0f81aa1d20a` live read guard; `b5cac57b2a398bf9ede7624f6a16e4f2802d46c8`, `87c638471ba3d3345561a6f84bf5b61b0205b784`, `00eb3eec5e60cdddbce76d1f03744f3f5c326c6e` route fixes; `824906b0d8a197220df15cf80e0ee98f6402e9a5`, `2d75c78d567ce98953868c405d07d2a0917d2c6a` mocked route regressions; `45d37ad615b20eaa70a43e07978ed5f960b8be87`, `a93d9bdd30cfe0351d3ad6701b523f25ca9a234b`, `387f5a7634be5b49eb4be0b9f6d099477ef9f190` PG revocation race suite; `ec5883763bd771d957f8e6c162e45e3972c6e726`, `5068c9984a221b4cc2bb269104b464b4b55bba87`, `92a1410896d67d4cd8da95b96ecabba14f45fcb6` canonical owner→family→token lock-order test/fix | Source and tests committed; GitHub CI per SHA mostly CANCELLED, PostgreSQL real race NOT RUN, no five-minute step-up on reads, other Platform GET endpoints not yet exhaustively audited | TODO |
| PLATFORM-PRIVATE-DIRECTORIES-READ-2026-10-28 | Platform audit metadata, cross-tenant fleet, integration inventory, and individual tenant detail/PII previously relied on mutable preflight-only Platform Owner state | `2d882dd659075911e811f59427b5a94e5d7b1cd6` and `e738394c0a7b5ffb4464bba89a952f4b3252cc3c` audit test/fix; `932c9c117cddc62f2dccfc5b62fdab388d8eccda`, `cd4a1c54184d5dafa1b532c8bc6e649817ca2bd0` tenant detail; `e189ce549567e80d7cb7aa218d65417badfb364f`, `e15de5397c3c08d277c7d6c59b0c7ab0ba9307a4` integration keys/installation lists; `e5cb174530ae28042a3ea76eabbff03937d782ca`, `38059628d9ac840124a19a4b71096440a8a122b1`, `3c74153b3f4aadfc23fed991ad664743ad3a7518` fleet inventory; PostgreSQL race expanded through `47e2b7e99a86a7983a0fbf08af49011fc7a82c6c`, `db9e7d88fcd1828a197cf45eb15d7624c525227d`, `da3ef62693270ca583b40bbc4d68851a895c5bb0`, `bad49411cd78aa1f3be1bdf2eded03b8b77aba2b` | Source and negative tests committed; real database race, App/Gateway CI, Windows Agent and Odoo hardware NOT VERIFIED due concurrent cancelled workflows; `jobs`, tenant directory and other Platform GET routes remain TODO | TODO |
| HW-01 print result | Neither Gateway `success` nor spooler submission proves physical paper | Status contract requires independent explicit physical evidence; never auto-retry unknown | No physical printer attached through GitHub API | BLOCKED |
| DATA-01 defense in depth | PostgreSQL RLS not enabled; predicates, composite FKs and transaction locks are tenant boundary | Audit every raw query, add safe migration only after staged design/coverage | Requires comprehensive source+staging audit | TODO |

## Cross-component invariants

- **Access:** password-only; `owner` vs `Full Access` tenant membership and separate global Platform Owner; invite recipient lists owner-only; tenant/company scope applies to every query and mutation.
- **Commercial:** manual plan request and explicit activation; no Stripe/checkout/auto-activation; admission balance resets at UTC calendar-month boundary; expired/blocked contracts cannot print despite reset; migration 0102 preserves prior consumption.
- **Job & physical output:** database states queued/claimed/printing/success/failed/expired; printed/not_printed/unknown is a separate evidence dimension; transport submission is not printed. Ambiguous output never automatically retries, fails over, or changes printer.
- **Identity:** Odoo installation+company+operation idempotency v2; tenant-scoped job/receipt identity and stable printer endpoint key; never resolve unknown printer by name or other tenant.
- **Printer geometry:** only matching driver/IPP observation or active validated operator geometry; owner desired/applied/observed revisions must converge before using configured profile. No guessed paper dimensions.
- **Verification:** full CI must be judged on the exact commit, not an earlier cancelled run. Windows installer build alone does not prove printed receipts.

## Audit inventory (every tracked file; status is evidence-based)

### `.github` — 2 files

**Logic:** GitHub Actions, branch reviews and release/security workflows. **Shared contract:** CI job conclusion on exact main SHA; never infer deployment or hardware success. **Inconsistencies / fix & next check:** CI sometimes cancelled when new commits supersede older runs; verify newest completed SHA.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `.github/CODEOWNERS`
- TODO `.github/dependabot.yml`

### `.github/workflows` — 6 files

**Logic:** GitHub Actions, branch reviews and release/security workflows. **Shared contract:** CI job conclusion on exact main SHA; never infer deployment or hardware success. **Inconsistencies / fix & next check:** CI sometimes cancelled when new commits supersede older runs; verify newest completed SHA.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `.github/workflows/build-windows.yml`
- TODO `.github/workflows/ci.yml`
- TODO `.github/workflows/docker.yml`
- TODO `.github/workflows/native-backports.yml`
- TODO `.github/workflows/security-supply-chain.yml`
- TODO `.github/workflows/static-security.yml`

### `(root)` — 46 files

**Logic:** Repository entrypoints, Docker/Next.js config and high-level documentation. **Shared contract:** Product decisions, deployment, networking, CI and data retention. **Inconsistencies / fix & next check:** Production deployment intentionally not attempted.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `.dockerignore`
- TODO `.env.example`
- TODO `.gitignore`
- TODO `.npmrc`
- TODO `.nvmrc`
- TODO `.oxlintrc.json`
- TODO `ADR.md`
- TODO `API.md`
- TODO `ARCHITECTURE.md`
- TODO `Caddyfile`
- TODO `DEPLOYMENT.md`
- TODO `Dockerfile`
- TODO `Dockerfile.odoo-hardened`
- TODO `Dockerfile.secure-images`
- TODO `INSTALLATION.md`
- TODO `LICENSE`
- TODO `MIGRATION.md`
- TODO `ODOO_INTEGRATION.md`
- TODO `OPERATIONS.md`
- TODO `PRINTERS.md`
- TODO `README.md`
- TODO `SECURITY.md`
- TODO `SERVER_FIRST_RUN.md`
- TODO `THIRD_PARTY_NOTICES.md`
- TODO `TROUBLESHOOTING.md`
- TODO `TYPOGRAPHY.md`
- TODO `docker-compose.acceptance.yml`
- TODO `docker-compose.ci.yml`
- TODO `docker-compose.metrics.yml`
- TODO `docker-compose.yml`
- TODO `drizzle.config.ts`
- TODO `eslint.config.mjs`
- TODO `next-env.d.ts`
- TODO `next.config.ts`
- TODO `package-lock.json`
- TODO `package.json`
- TODO `postcss.config.mjs`
- TODO `proxy.ts`
- TODO `requirements-test.txt`
- TODO `server.ts`
- TODO `tsconfig.json`
- TODO `vite.desktop.config.mts`
- TODO `vitest.config.mts`
- TODO `vitest.integration.config.mts`
- TODO `vitest.test-groups.mts`
- TODO `vitest.unit.config.mts`

### `agent` — 3 files

**Logic:** Go CLI/service, API contracts, inventory discovery and tests. **Shared contract:** Gateway agent pairing, WS and RPC; no printer substitution. **Inconsistencies / fix & next check:** Native Windows service/driver hardware tests NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `agent/Makefile`
- TODO `agent/go.mod`
- TODO `agent/go.sum`

### `agent/cmd/agent` — 10 files

**Logic:** Go CLI/service, API contracts, inventory discovery and tests. **Shared contract:** Gateway agent pairing, WS and RPC; no printer substitution. **Inconsistencies / fix & next check:** Native Windows service/driver hardware tests NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `agent/cmd/agent/main.go`
- TODO `agent/cmd/agent/main_test.go`
- TODO `agent/cmd/agent/restart_release_test.go`
- TODO `agent/cmd/agent/runtime_singleton_other.go`
- TODO `agent/cmd/agent/runtime_singleton_windows.go`
- TODO `agent/cmd/agent/service_install_other.go`
- TODO `agent/cmd/agent/service_install_windows.go`
- TODO `agent/cmd/agent/service_ownership_windows_test.go`
- TODO `agent/cmd/agent/uninstall_userdata_windows_test.go`
- TODO `agent/cmd/agent/uninstall_v5_test.go`

### `agent/cmd/cli` — 17 files

**Logic:** Go CLI/service, API contracts, inventory discovery and tests. **Shared contract:** Gateway agent pairing, WS and RPC; no printer substitution. **Inconsistencies / fix & next check:** Native Windows service/driver hardware tests NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `agent/cmd/cli/cleanup.go`
- TODO `agent/cmd/cli/cleanup_test.go`
- TODO `agent/cmd/cli/cli_integration_test.go`
- TODO `agent/cmd/cli/diagnose.go`
- TODO `agent/cmd/cli/diagnose_audit_test.go`
- TODO `agent/cmd/cli/diagnose_test.go`
- TODO `agent/cmd/cli/diagnostic_message_test.go`
- TODO `agent/cmd/cli/gateway.go`
- TODO `agent/cmd/cli/gateway_body_test.go`
- TODO `agent/cmd/cli/gateway_test.go`
- TODO `agent/cmd/cli/helpers.go`
- TODO `agent/cmd/cli/main.go`
- TODO `agent/cmd/cli/manual_identity_test.go`
- TODO `agent/cmd/cli/printer_mutations_v5_test.go`
- TODO `agent/cmd/cli/printer_sharing.go`
- TODO `agent/cmd/cli/printer_sharing_test.go`
- TODO `agent/cmd/cli/printers_add_alias_test.go`

### `agent/configs` — 1 files

**Logic:** Go CLI/service, API contracts, inventory discovery and tests. **Shared contract:** Gateway agent pairing, WS and RPC; no printer substitution. **Inconsistencies / fix & next check:** Native Windows service/driver hardware tests NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `agent/configs/config.yaml.example`

### `agent/internal/agent` — 64 files

**Logic:** Agent lifecycle, WS delivery, print claim and local durable replay. **Shared contract:** Fenced claim tokens and Gateway job states; no automatic retry after uncertain print. **Inconsistencies / fix & next check:** Real reconnect/crash/partial-spool output needs fault injection.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `agent/internal/agent/admission_wait_test.go`
- TODO `agent/internal/agent/agent.go`
- TODO `agent/internal/agent/agent_test.go`
- TODO `agent/internal/agent/attempt_evidence_integration_test.go`
- TODO `agent/internal/agent/attempt_evidence_test.go`
- TODO `agent/internal/agent/audit_admission_test.go`
- TODO `agent/internal/agent/audit_regressions_test.go`
- TODO `agent/internal/agent/backend_generation_test.go`
- TODO `agent/internal/agent/backend_retirement_test.go`
- TODO `agent/internal/agent/desired_capability_fence_test.go`
- TODO `agent/internal/agent/desired_state.go`
- TODO `agent/internal/agent/desired_state_budget_test.go`
- TODO `agent/internal/agent/desired_state_pagination.go`
- TODO `agent/internal/agent/desired_state_pagination_test.go`
- TODO `agent/internal/agent/desired_state_test.go`
- TODO `agent/internal/agent/device_class.go`
- TODO `agent/internal/agent/device_class_test.go`
- TODO `agent/internal/agent/discovery_abandoned_cap_test.go`
- TODO `agent/internal/agent/discovery_ack_v5_test.go`
- TODO `agent/internal/agent/discovery_bounded_test.go`
- TODO `agent/internal/agent/discovery_manager.go`
- TODO `agent/internal/agent/discovery_manager_test.go`
- TODO `agent/internal/agent/discovery_response_test.go`
- TODO `agent/internal/agent/discovery_semaphore_test.go`
- TODO `agent/internal/agent/discovery_startup_v5_test.go`
- TODO `agent/internal/agent/dispatch_test.go`
- TODO `agent/internal/agent/gateway_transport_test.go`
- TODO `agent/internal/agent/gateway_url_test.go`
- TODO `agent/internal/agent/geometry_projection_test.go`
- TODO `agent/internal/agent/heartbeat_budget_test.go`
- TODO `agent/internal/agent/heartbeat_disablement_completeness_test.go`
- TODO `agent/internal/agent/heartbeat_observation_test.go`
- TODO `agent/internal/agent/heartbeat_pagination.go`
- TODO `agent/internal/agent/heartbeat_pagination_test.go`
- TODO `agent/internal/agent/inventory_version_test.go`
- TODO `agent/internal/agent/ipp_identity_persistence.go`
- TODO `agent/internal/agent/ipp_identity_persistence_test.go`
- TODO `agent/internal/agent/job_ack_audit_test.go`
- TODO `agent/internal/agent/lifecycle_fence_test.go`
- TODO `agent/internal/agent/manual_identity_test.go`
- TODO `agent/internal/agent/nominal_paper_width_test.go`
- TODO `agent/internal/agent/operational_verification_test.go`
- TODO `agent/internal/agent/output_evidence.go`
- TODO `agent/internal/agent/output_replay_v3_test.go`
- TODO `agent/internal/agent/pairing.go`
- TODO `agent/internal/agent/pairing_test.go`
- TODO `agent/internal/agent/pdf_output_heartbeat_contract_test.go`
- TODO `agent/internal/agent/poll_response.go`
- TODO `agent/internal/agent/poll_response_test.go`
- TODO `agent/internal/agent/print_transport_status_test.go`
- TODO `agent/internal/agent/printer_alias_contract_test.go`
- TODO `agent/internal/agent/printer_sharing.go`
- TODO `agent/internal/agent/printer_sharing_test.go`
- TODO `agent/internal/agent/registry_disablement_v5_test.go`
- TODO `agent/internal/agent/registry_recovery_v5_test.go`
- TODO `agent/internal/agent/runtime_verification.go`
- TODO `agent/internal/agent/shutdown_lock_test.go`
- TODO `agent/internal/agent/spooler_jobid_test.go`
- TODO `agent/internal/agent/terminal_outbox_fairness_test.go`
- TODO `agent/internal/agent/terminal_rereport_test.go`
- TODO `agent/internal/agent/transport_observation_test.go`
- TODO `agent/internal/agent/usb_config_contract_test.go`
- TODO `agent/internal/agent/ws_delivery_test.go`
- TODO `agent/internal/agent/ws_reconnect.go`
- TODO `agent/internal/agent/ws_reconnect_test.go`

### `agent/internal/config` — 19 files

**Logic:** Agent configuration and endpoint transport authorization. **Shared contract:** Gateway printer input shape and local private-network policy. **Inconsistencies / fix & next check:** Environmental Windows/GPO proof NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `agent/internal/config/config.go`
- TODO `agent/internal/config/config_test.go`
- TODO `agent/internal/config/endpoint_redaction_test.go`
- TODO `agent/internal/config/gateway_url.go`
- TODO `agent/internal/config/gateway_url_test.go`
- TODO `agent/internal/config/geometry.go`
- TODO `agent/internal/config/paths.go`
- TODO `agent/internal/config/paths_test.go`
- TODO `agent/internal/config/pdf_output.go`
- TODO `agent/internal/config/pdf_output_test.go`
- TODO `agent/internal/config/printer_sharing.go`
- TODO `agent/internal/config/printer_sharing_test.go`
- TODO `agent/internal/config/replace_file.go`
- TODO `agent/internal/config/replace_file_posix.go`
- TODO `agent/internal/config/replace_file_windows.go`
- TODO `agent/internal/config/reprint_policy_test.go`
- TODO `agent/internal/config/security_other.go`
- TODO `agent/internal/config/security_windows.go`
- TODO `agent/internal/config/usb_identity_test.go`

### `agent/internal/integration` — 3 files

**Logic:** Go CLI/service, API contracts, inventory discovery and tests. **Shared contract:** Gateway agent pairing, WS and RPC; no printer substitution. **Inconsistencies / fix & next check:** Native Windows service/driver hardware tests NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `agent/internal/integration/crash_test.go`
- TODO `agent/internal/integration/failure_test.go`
- TODO `agent/internal/integration/mock_e2e_test.go`

### `agent/internal/payload` — 3 files

**Logic:** Go CLI/service, API contracts, inventory discovery and tests. **Shared contract:** Gateway agent pairing, WS and RPC; no printer substitution. **Inconsistencies / fix & next check:** Native Windows service/driver hardware tests NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `agent/internal/payload/payload.go`
- TODO `agent/internal/payload/payload_bench_test.go`
- TODO `agent/internal/payload/payload_test.go`

### `agent/internal/printer` — 220 files

**Logic:** Go printer backends, discovery, geometry, spooler/IPP/USB physical execution. **Shared contract:** Gateway routing/payload and Odoo receipt geometry; unknown paper outcome is not printed. **Inconsistencies / fix & next check:** Real Windows printer, transport failure and duplicate hardware identity are NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `agent/internal/printer/admission_transport_test.go`
- TODO `agent/internal/printer/admission_windows_test.go`
- TODO `agent/internal/printer/audit_regressions_test.go`
- TODO `agent/internal/printer/audit_usb_windows_test.go`
- TODO `agent/internal/printer/capability.go`
- TODO `agent/internal/printer/capability_test.go`
- TODO `agent/internal/printer/capability_transport_test.go`
- TODO `agent/internal/printer/classify.go`
- TODO `agent/internal/printer/classify_device.go`
- TODO `agent/internal/printer/classify_device_test.go`
- TODO `agent/internal/printer/disablement.go`
- TODO `agent/internal/printer/disablement_v5_test.go`
- TODO `agent/internal/printer/discovery.go`
- TODO `agent/internal/printer/discovery_destination_test.go`
- TODO `agent/internal/printer/discovery_extended.go`
- TODO `agent/internal/printer/discovery_extended_test.go`
- TODO `agent/internal/printer/discovery_identity_test.go`
- TODO `agent/internal/printer/discovery_legacy_id_collision_test.go`
- TODO `agent/internal/printer/discovery_other.go`
- TODO `agent/internal/printer/discovery_progress_test.go`
- TODO `agent/internal/printer/discovery_protocol_conflict_test.go`
- TODO `agent/internal/printer/discovery_resilience_test.go`
- TODO `agent/internal/printer/discovery_scan.go`
- TODO `agent/internal/printer/discovery_scan_test.go`
- TODO `agent/internal/printer/discovery_targets.go`
- TODO `agent/internal/printer/discovery_targets_test.go`
- TODO `agent/internal/printer/discovery_test.go`
- TODO `agent/internal/printer/discovery_usb_legacy_id_collision_test.go`
- TODO `agent/internal/printer/discovery_windows.go`
- TODO `agent/internal/printer/dispatch_admission.go`
- TODO `agent/internal/printer/dispatch_admission_test.go`
- TODO `agent/internal/printer/document.go`
- TODO `agent/internal/printer/document_test.go`
- TODO `agent/internal/printer/document_timeout_test.go`
- TODO `agent/internal/printer/factory.go`
- TODO `agent/internal/printer/factory_usb_identity_test.go`
- TODO `agent/internal/printer/gateway_printer_id.go`
- TODO `agent/internal/printer/gateway_printer_id_contract_test.go`
- TODO `agent/internal/printer/geometry.go`
- TODO `agent/internal/printer/geometry_contract_test.go`
- TODO `agent/internal/printer/hardening_test.go`
- TODO `agent/internal/printer/health.go`
- TODO `agent/internal/printer/health_framing_test.go`
- TODO `agent/internal/printer/health_test.go`
- TODO `agent/internal/printer/hotpath_bench_test.go`
- TODO `agent/internal/printer/identity_capability_types_test.go`
- TODO `agent/internal/printer/identity_placeholder_test.go`
- TODO `agent/internal/printer/image.go`
- TODO `agent/internal/printer/image_pdf_color_test.go`
- TODO `agent/internal/printer/image_pdf_pages.go`
- TODO `agent/internal/printer/image_test.go`
- TODO `agent/internal/printer/inventory.go`
- TODO `agent/internal/printer/inventory_test.go`
- TODO `agent/internal/printer/ipp.go`
- TODO `agent/internal/printer/ipp_acceptance.go`
- TODO `agent/internal/printer/ipp_acceptance_test.go`
- TODO `agent/internal/printer/ipp_alias_registry_convergence_test.go`
- TODO `agent/internal/printer/ipp_attributes.go`
- TODO `agent/internal/printer/ipp_attributes_test.go`
- TODO `agent/internal/printer/ipp_collections.go`
- TODO `agent/internal/printer/ipp_discovery.go`
- TODO `agent/internal/printer/ipp_formats.go`
- TODO `agent/internal/printer/ipp_formats_test.go`
- TODO `agent/internal/printer/ipp_identity.go`
- TODO `agent/internal/printer/ipp_identity_persistence.go`
- TODO `agent/internal/printer/ipp_identity_persistence_test.go`
- TODO `agent/internal/printer/ipp_identity_test.go`
- TODO `agent/internal/printer/ipp_ipv6_normalization_test.go`
- TODO `agent/internal/printer/ipp_jfif.go`
- TODO `agent/internal/printer/ipp_jfif_test.go`
- TODO `agent/internal/printer/ipp_jpeg_geometry.go`
- TODO `agent/internal/printer/ipp_jpeg_geometry_test.go`
- TODO `agent/internal/printer/ipp_lifecycle_test.go`
- TODO `agent/internal/printer/ipp_mdns_families_test.go`
- TODO `agent/internal/printer/ipp_media.go`
- TODO `agent/internal/printer/ipp_media_regression_test.go`
- TODO `agent/internal/printer/ipp_media_selection_test.go`
- TODO `agent/internal/printer/ipp_pdf_geometry.go`
- TODO `agent/internal/printer/ipp_probe_response_limit_test.go`
- TODO `agent/internal/printer/ipp_pwg_other.go`
- TODO `agent/internal/printer/ipp_pwg_windows.go`
- TODO `agent/internal/printer/ipp_pwg_windows_test.go`
- TODO `agent/internal/printer/ipp_raster_fallback_windows_test.go`
- TODO `agent/internal/printer/ipp_raster_prepare.go`
- TODO `agent/internal/printer/ipp_raster_prepare_test.go`
- TODO `agent/internal/printer/ipp_render_other.go`
- TODO `agent/internal/printer/ipp_render_windows.go`
- TODO `agent/internal/printer/ipp_render_windows_test.go`
- TODO `agent/internal/printer/ipp_secret_redaction_test.go`
- TODO `agent/internal/printer/ipp_status_severity_test.go`
- TODO `agent/internal/printer/ipp_test.go`
- TODO `agent/internal/printer/local_identity_admission_test.go`
- TODO `agent/internal/printer/local_test_v5_test.go`
- TODO `agent/internal/printer/manual_registry_contract_test.go`
- TODO `agent/internal/printer/mdns_ipp_verification_test.go`
- TODO `agent/internal/printer/mdns_result_limit_test.go`
- TODO `agent/internal/printer/network.go`
- TODO `agent/internal/printer/network_discovery.go`
- TODO `agent/internal/printer/network_discovery_health_test.go`
- TODO `agent/internal/printer/network_integration_test.go`
- TODO `agent/internal/printer/network_lifecycle_test.go`
- TODO `agent/internal/printer/network_status_evidence_test.go`
- TODO `agent/internal/printer/network_test.go`
- TODO `agent/internal/printer/network_test_fastpath_test.go`
- TODO `agent/internal/printer/nil_uuid_encodings_test.go`
- TODO `agent/internal/printer/outcome.go`
- TODO `agent/internal/printer/outcome_test.go`
- TODO `agent/internal/printer/outcome_wrapping_test.go`
- TODO `agent/internal/printer/output_evidence.go`
- TODO `agent/internal/printer/output_evidence_test.go`
- TODO `agent/internal/printer/pdf.go`
- TODO `agent/internal/printer/pdf_bitmap_windows.go`
- TODO `agent/internal/printer/pdf_devmode_windows.go`
- TODO `agent/internal/printer/pdf_fit_test.go`
- TODO `agent/internal/printer/pdf_gdi.go`
- TODO `agent/internal/printer/pdf_gdi_test.go`
- TODO `agent/internal/printer/pdf_gdi_windows_test.go`
- TODO `agent/internal/printer/pdf_geometry.go`
- TODO `agent/internal/printer/pdf_geometry_test.go`
- TODO `agent/internal/printer/pdf_other.go`
- TODO `agent/internal/printer/pdf_output.go`
- TODO `agent/internal/printer/pdf_output_cold_test.go`
- TODO `agent/internal/printer/pdf_output_files.go`
- TODO `agent/internal/printer/pdf_output_security_other.go`
- TODO `agent/internal/printer/pdf_output_security_windows.go`
- TODO `agent/internal/printer/pdf_output_test.go`
- TODO `agent/internal/printer/pdf_receipt.go`
- TODO `agent/internal/printer/pdf_receipt_test.go`
- TODO `agent/internal/printer/pdf_render_bounds.go`
- TODO `agent/internal/printer/pdf_render_bounds_test.go`
- TODO `agent/internal/printer/pdf_render_wait.go`
- TODO `agent/internal/printer/pdf_render_wait_test.go`
- TODO `agent/internal/printer/pdf_test.go`
- TODO `agent/internal/printer/pdf_windows.go`
- TODO `agent/internal/printer/pdf_windows_test.go`
- TODO `agent/internal/printer/pdfium_pool.go`
- TODO `agent/internal/printer/pdfium_pool_test.go`
- TODO `agent/internal/printer/pdfium_warmup.go`
- TODO `agent/internal/printer/peripherals.go`
- TODO `agent/internal/printer/peripherals_test.go`
- TODO `agent/internal/printer/physical_only.go`
- TODO `agent/internal/printer/preflight_ownership_windows_test.go`
- TODO `agent/internal/printer/printer.go`
- TODO `agent/internal/printer/printer_sharing.go`
- TODO `agent/internal/printer/printer_sharing_test.go`
- TODO `agent/internal/printer/printer_wire_identity_test.go`
- TODO `agent/internal/printer/production_audit_test.go`
- TODO `agent/internal/printer/pwg_options.go`
- TODO `agent/internal/printer/pwg_raster.go`
- TODO `agent/internal/printer/pwg_raster_test.go`
- TODO `agent/internal/printer/pwg_unavailable_test.go`
- TODO `agent/internal/printer/raster_capability.go`
- TODO `agent/internal/printer/raster_capability_test.go`
- TODO `agent/internal/printer/raster_document.go`
- TODO `agent/internal/printer/receipt_page_break.go`
- TODO `agent/internal/printer/receipt_page_break_test.go`
- TODO `agent/internal/printer/receipt_pagination_test.go`
- TODO `agent/internal/printer/registration_identity_v3_test.go`
- TODO `agent/internal/printer/registry.go`
- TODO `agent/internal/printer/registry_atomic_replace_test.go`
- TODO `agent/internal/printer/registry_budget_test.go`
- TODO `agent/internal/printer/registry_ipp_alias_test.go`
- TODO `agent/internal/printer/registry_ipp_uuid_test.go`
- TODO `agent/internal/printer/registry_missing_test.go`
- TODO `agent/internal/printer/registry_recovery_v5_test.go`
- TODO `agent/internal/printer/results_close_race_test.go`
- TODO `agent/internal/printer/simulated_outcome_test.go`
- TODO `agent/internal/printer/snmp_discovery.go`
- TODO `agent/internal/printer/snmp_get_test.go`
- TODO `agent/internal/printer/snmp_identity_evidence_test.go`
- TODO `agent/internal/printer/spooler_evidence.go`
- TODO `agent/internal/printer/spooler_evidence_test.go`
- TODO `agent/internal/printer/spooler_evidence_windows_test.go`
- TODO `agent/internal/printer/spooler_identity_continuity_test.go`
- TODO `agent/internal/printer/spooler_image_geometry_windows.go`
- TODO `agent/internal/printer/spooler_jobid_test.go`
- TODO `agent/internal/printer/spooler_liveness_windows_test.go`
- TODO `agent/internal/printer/spooler_query.go`
- TODO `agent/internal/printer/spooler_query_test.go`
- TODO `agent/internal/printer/spooler_query_windows_test.go`
- TODO `agent/internal/printer/spooler_queue_guid_windows.go`
- TODO `agent/internal/printer/spooler_receipt.go`
- TODO `agent/internal/printer/spooler_receipt_test.go`
- TODO `agent/internal/printer/spooler_receipt_windows.go`
- TODO `agent/internal/printer/spooler_receipt_windows_test.go`
- TODO `agent/internal/printer/spooler_scope.go`
- TODO `agent/internal/printer/spooler_scope_test.go`
- TODO `agent/internal/printer/spooler_status_detail.go`
- TODO `agent/internal/printer/spooler_status_detail_test.go`
- TODO `agent/internal/printer/spooler_stub.go`
- TODO `agent/internal/printer/spooler_test.go`
- TODO `agent/internal/printer/spooler_windows.go`
- TODO `agent/internal/printer/spooler_windows_test.go`
- TODO `agent/internal/printer/stable_id.go`
- TODO `agent/internal/printer/stable_id_ipp_ports_test.go`
- TODO `agent/internal/printer/stable_id_test.go`
- TODO `agent/internal/printer/stable_id_unicode_test.go`
- TODO `agent/internal/printer/stable_id_uuid_case_test.go`
- TODO `agent/internal/printer/standard_pdf_safety_test.go`
- TODO `agent/internal/printer/test_page.go`
- TODO `agent/internal/printer/test_page_test.go`
- TODO `agent/internal/printer/test_page_windows.go`
- TODO `agent/internal/printer/test_page_windows_test.go`
- BLOCKED `agent/internal/printer/testdata/cmyk-patches.jpg`
- BLOCKED `agent/internal/printer/testdata/receipt-geometry.jpg`
- TODO `agent/internal/printer/testdata/receipt-geometry.md`
- TODO `agent/internal/printer/thermal_receipt_geometry_test.go`
- TODO `agent/internal/printer/transport_observation_windows_test.go`
- TODO `agent/internal/printer/usb_binding.go`
- TODO `agent/internal/printer/usb_binding_test.go`
- TODO `agent/internal/printer/usb_binding_windows_test.go`
- TODO `agent/internal/printer/usb_other.go`
- TODO `agent/internal/printer/usb_registry.go`
- TODO `agent/internal/printer/usb_registry_test.go`
- TODO `agent/internal/printer/usb_windows.go`
- TODO `agent/internal/printer/usb_windows_test.go`
- TODO `agent/internal/printer/v3_geometry_regressions_test.go`
- TODO `agent/internal/printer/vendor_fax_queue_test.go`
- TODO `agent/internal/printer/verification.go`
- TODO `agent/internal/printer/verification_ipp.go`
- TODO `agent/internal/printer/verification_network.go`
- TODO `agent/internal/printer/verification_other.go`
- TODO `agent/internal/printer/verification_test.go`
- TODO `agent/internal/printer/verification_windows.go`
- TODO `agent/internal/printer/wsd_completion_evidence_test.go`
- TODO `agent/internal/printer/wsd_discovery.go`
- TODO `agent/internal/printer/wsd_probe_test.go`

### `agent/internal/queue` — 8 files

**Logic:** Agent pending queue and backpressure. **Shared contract:** Queue limits and terminal result replay. **Inconsistencies / fix & next check:** Hardware/agent soak proof outstanding.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `agent/internal/queue/cleanup.go`
- TODO `agent/internal/queue/cleanup_test.go`
- TODO `agent/internal/queue/job_identity_immutability_test.go`
- TODO `agent/internal/queue/legacy_status_test.go`
- TODO `agent/internal/queue/output_evidence_v3_test.go`
- TODO `agent/internal/queue/path_test.go`
- TODO `agent/internal/queue/queue.go`
- TODO `agent/internal/queue/queue_bench_test.go`
- TODO `agent/internal/queue/queue_test.go`

### `agent/internal/storage` — 10 files

**Logic:** Agent durable local evidence storage. **Shared contract:** Agent unknown-outcome markers, idempotent job/result replay. **Inconsistencies / fix & next check:** Reboot and storage-corruption recovery NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `agent/internal/storage/at_rest_warning_test.go`
- TODO `agent/internal/storage/replace_file_posix.go`
- TODO `agent/internal/storage/replace_file_windows.go`
- TODO `agent/internal/storage/secure.go`
- TODO `agent/internal/storage/secure_posix.go`
- TODO `agent/internal/storage/secure_test.go`
- TODO `agent/internal/storage/secure_windows.go`
- TODO `agent/internal/storage/security_other.go`
- TODO `agent/internal/storage/security_windows.go`
- TODO `agent/internal/storage/security_windows_test.go`

### `agent/internal/testutil` — 2 files

**Logic:** Go CLI/service, API contracts, inventory discovery and tests. **Shared contract:** Gateway agent pairing, WS and RPC; no printer substitution. **Inconsistencies / fix & next check:** Native Windows service/driver hardware tests NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `agent/internal/testutil/mock_printer.go`
- TODO `agent/internal/testutil/mock_printer_test.go`

### `contracts` — 8 files

**Logic:** Cross-component JSON contracts and fixture vectors. **Shared contract:** Go Agent, Gateway TS, Odoo Python, Tauri Rust compatibility. **Inconsistencies / fix & next check:** Run producer/consumer boundary tests together.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `contracts/gateway-console-contract.json`
- TODO `contracts/print-payload-contract.json`
- TODO `contracts/printer-geometry-contract.json`
- TODO `contracts/printer-geometry-fixtures.json`
- TODO `contracts/printer-operational-verification-contract.json`
- TODO `contracts/printer-operational-verification-fixtures.json`
- TODO `contracts/printer-presentation-contract.json`
- TODO `contracts/printer-sharing-contract.json`

### `docs` — 19 files

**Logic:** Documentation, operational playbooks and integration specs. **Shared contract:** Matches actual Gateway/Agent/Odoo/API schema and enforced CI gates. **Inconsistencies / fix & next check:** Documentation is not a substitute for runtime tests.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `docs/CONTAINER_RUNTIME.md`
- TODO `docs/DATABASE.md`
- TODO `docs/DATABASE_ROLES.md`
- TODO `docs/IPP_PRINT_COMPATIBILITY.md`
- TODO `docs/LINT_TOOLCHAIN.md`
- TODO `docs/MANUAL_ONLY_DATABASE.md`
- TODO `docs/METRICS_COLLECTION.md`
- TODO `docs/ODOO_RECEIPT_GEOMETRY.md`
- TODO `docs/OPERATIONS_ACCEPTANCE.md`
- TODO `docs/PASSWORD_AUTHENTICATION.md`
- TODO `docs/RECEIPT_GEOMETRY_RELIABILITY.md`
- TODO `docs/RELEASE_GATES.md`
- TODO `docs/SECURITY_AUTHORIZATION.md`
- TODO `docs/SECURITY_COMMUNICATIONS.md`
- TODO `docs/SECURITY_INPUT_VALIDATION.md`
- TODO `docs/V5_RELEASE_NOTES.md`
- TODO `docs/WINDOWS_RELEASE_ACCEPTANCE.md`
- TODO `docs/WINDOWS_SERVICE_RECOVERY.md`
- TODO `docs/WINDOWS_TOOLCHAIN_ACCEPTANCE.md`

### `docs/acceptance` — 2 files

**Logic:** Documentation, operational playbooks and integration specs. **Shared contract:** Matches actual Gateway/Agent/Odoo/API schema and enforced CI gates. **Inconsistencies / fix & next check:** Documentation is not a substitute for runtime tests.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `docs/acceptance/2026-10-26-gateway-regressions.md`
- TODO `docs/acceptance/windows-result-template.json`

### `docs/engineering` — 4 files

**Logic:** Continuous engineering notebook and per-file evidence ledger. **Shared contract:** Source-to-test trace and exact CI SHA; no invented PASS. **Inconsistencies / fix & next check:** Legacy entries describe historical policies; append superseding facts rather than deleting evidence.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `docs/engineering/FILE_COVERAGE_LEDGER.md`
- TODO `docs/engineering/MODULE_COVERAGE_LEDGER.md`
- TODO `docs/engineering/NOTES.md`
- TODO `docs/engineering/SYSTEM_UNIFICATION_NOTEBOOK.md`

### `docs/runtime-hardening` — 13 files

**Logic:** Caddy, container, package and runtime-hardening references. **Shared contract:** Docker images, TLS, native version pins, cloud deployment. **Inconsistencies / fix & next check:** Populated staging migration, backup/restore, exact image attestation NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `docs/runtime-hardening/README.md`
- TODO `docs/runtime-hardening/alpine-security-artifacts.json`
- TODO `docs/runtime-hardening/apply-odoo19-pdf-bounds.py`
- TODO `docs/runtime-hardening/apply-os-security-profile.py`
- TODO `docs/runtime-hardening/artifacts-python312-linux-x86_64.json`
- TODO `docs/runtime-hardening/build-tools-artifacts.json`
- TODO `docs/runtime-hardening/build-tools.lock`
- TODO `docs/runtime-hardening/container-bases.json`
- TODO `docs/runtime-hardening/odoo19-pypdf-bounds.patch`
- TODO `docs/runtime-hardening/os-security-artifacts.json`
- TODO `docs/runtime-hardening/requirements-python312-linux-x86_64.lock`
- TODO `docs/runtime-hardening/verify-odoo19-pdf-bounds.py`
- TODO `docs/runtime-hardening/verify-source-map-js-security.cjs`

### `docs/runtime-hardening/caddy` — 3 files

**Logic:** Caddy, container, package and runtime-hardening references. **Shared contract:** Docker images, TLS, native version pins, cloud deployment. **Inconsistencies / fix & next check:** Populated staging migration, backup/restore, exact image attestation NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `docs/runtime-hardening/caddy/dependency_security_test.go`
- TODO `docs/runtime-hardening/caddy/go.mod`
- TODO `docs/runtime-hardening/caddy/go.sum`

### `docs/runtime-hardening/gosu` — 3 files

**Logic:** Caddy, container, package and runtime-hardening references. **Shared contract:** Docker images, TLS, native version pins, cloud deployment. **Inconsistencies / fix & next check:** Populated staging migration, backup/restore, exact image attestation NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `docs/runtime-hardening/gosu/dependency_security_test.go`
- TODO `docs/runtime-hardening/gosu/go.mod`
- TODO `docs/runtime-hardening/gosu/go.sum`

### `docs/superpowers/plans` — 1 files

**Logic:** Documentation, operational playbooks and integration specs. **Shared contract:** Matches actual Gateway/Agent/Odoo/API schema and enforced CI gates. **Inconsistencies / fix & next check:** Documentation is not a substitute for runtime tests.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `docs/superpowers/plans/2026-10-25-v5-scope-tls-verification.md`

### `drizzle` — 103 files

**Logic:** PostgreSQL forward migrations, constraints, ledger keys. **Shared contract:** Tenant scoped indexes/FKs, UTC month quota, subscription/print idempotency. **Inconsistencies / fix & next check:** 0102 requires drained writers, backup/restore and non-destructive staged upgrade.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `drizzle/0000_simple_tigra.sql`
- TODO `drizzle/0001_phase1_branch_foundation.sql`
- TODO `drizzle/0002_add_document_types.sql`
- TODO `drizzle/0003_add_idempotency_key.sql`
- TODO `drizzle/0004_add_job_delivery_tracking.sql`
- TODO `drizzle/0005_auth_rate_limits.sql`
- TODO `drizzle/0006_architecture_hardening.sql`
- TODO `drizzle/0007_auth_rate_limit_retention.sql`
- TODO `drizzle/0008_remove_pcl_contract.sql`
- TODO `drizzle/0009_runtime_invariant_guard.sql`
- TODO `drizzle/0010_discovery.sql`
- TODO `drizzle/0011_worker_schema_fk_hardening.sql`
- TODO `drizzle/0012_runtime_state_checks.sql`
- TODO `drizzle/0013_runtime_state_constraint_scope_fix.sql`
- TODO `drizzle/0014_discovery_state_checks.sql`
- TODO `drizzle/0015_metrics_and_agent_notifications.sql`
- TODO `drizzle/0016_print_job_rate_limits.sql`
- TODO `drizzle/0017_notify_requeued_jobs.sql`
- TODO `drizzle/0018_global_print_job_idempotency.sql`
- TODO `drizzle/0019_drop_legacy_print_destination_fk.sql`
- TODO `drizzle/0020_remove_gateway_business_ownership.sql`
- TODO `drizzle/0021_scope_print_jobs_to_api_key.sql`
- TODO `drizzle/0022_pairing_code_hash.sql`
- TODO `drizzle/0023_internal_print_job_idempotency.sql`
- TODO `drizzle/0024_claim_fencing_and_payload_contract.sql`
- TODO `drizzle/0025_constraint_scope_and_protocol_contract_fix.sql`
- TODO `drizzle/0026_printer_type_default_alignment.sql`
- TODO `drizzle/0027_printers_protocol_check_windows_spooler.sql`
- TODO `drizzle/0028_add_multi_tenancy.sql`
- TODO `drizzle/0029_enforce_tenant_id_not_null.sql`
- TODO `drizzle/0030_tenant_domains_and_manager_sessions.sql`
- TODO `drizzle/0031_enforce_tenant_cross_table_foreign_keys.sql`
- TODO `drizzle/0032_pairing_code_hash_unique.sql`
- TODO `drizzle/0033_manager_identity.sql`
- TODO `drizzle/0034_saas_control_plane.sql`
- TODO `drizzle/0035_tenant_membership_role_check.sql`
- TODO `drizzle/0036_print_job_request_id.sql`
- TODO `drizzle/0037_customer_identity_billing.sql`
- TODO `drizzle/0038_trial_state.sql`
- TODO `drizzle/0039_billing_event_ordering.sql`
- TODO `drizzle/0040_tenant_lifecycle.sql`
- TODO `drizzle/0041_fix_composite_fk_prerequisites.sql`
- TODO `drizzle/0042_dos_indexes.sql`
- TODO `drizzle/0043_add_platform_owner.sql`
- TODO `drizzle/0044_single_platform_owner_idx.sql`
- TODO `drizzle/0045_audit_events_platform_scope.sql`
- TODO `drizzle/0046_scope_internal_print_job_idempotency.sql`
- TODO `drizzle/0047_desired_printer_reconciliation.sql`
- TODO `drizzle/0048_discovery_running_agent_unique.sql`
- TODO `drizzle/0049_tenant_scoped_idempotency_and_owner_unique.sql`
- TODO `drizzle/0050_billing_single_flight_state.sql`
- TODO `drizzle/0051_agent_lifecycle_revision.sql`
- TODO `drizzle/0052_plan_catalog_management.sql`
- TODO `drizzle/0053_discovery_spooler_name.sql`
- TODO `drizzle/0054_odoo_gateway_activation_state.sql`
- TODO `drizzle/0055_job_events_and_spooler_job_id.sql`
- TODO `drizzle/0056_discovered_device_class_not_null.sql`
- TODO `drizzle/0057_api_key_composite_index.sql`
- TODO `drizzle/0058_scope_odoo_activation_to_api_key.sql`
- TODO `drizzle/0059_remove_api_key_restrictions.sql`
- TODO `drizzle/0060_preserve_stripe_subscription_states.sql`
- TODO `drizzle/0061_print_usage_quota.sql`
- TODO `drizzle/0062_subscription_period_start_default.sql`
- TODO `drizzle/0063_job_events_tenant_fk.sql`
- TODO `drizzle/0064_odoo_key_rotation_grace.sql`
- TODO `drizzle/0065_api_key_rotation_state_check.sql`
- TODO `drizzle/0066_job_events_cascade.sql`
- TODO `drizzle/0067_print_job_wall_clock.sql`
- TODO `drizzle/0068_billing_entitlement_block.sql`
- TODO `drizzle/0069_redact_legacy_claim_ids.sql`
- TODO `drizzle/0070_discovered_device_identity.sql`
- TODO `drizzle/0071_remove_print_job_rate_limits.sql`
- TODO `drizzle/0072_tenant_scoped_printer_identity.sql`
- TODO `drizzle/0073_refresh_tokens.sql`
- TODO `drizzle/0074_token_cascade_cleanup.sql`
- TODO `drizzle/0075_discovery_checks_cleanup.sql`
- TODO `drizzle/0076_discovery_candidate_status_check.sql`
- TODO `drizzle/0077_agent_inventory_snapshots.sql`
- TODO `drizzle/0078_hot_path_query_indexes.sql`
- TODO `drizzle/0079_team_collection_pagination_indexes.sql`
- TODO `drizzle/0080_inventory_snapshot_version.sql`
- TODO `drizzle/0081_physical_printers_only.sql`
- TODO `drizzle/0082_audit_repairs_and_maintenance_indexes.sql`
- TODO `drizzle/0083_e2e_capture_runs.sql`
- TODO `drizzle/0084_printer_cloud_sharing.sql`
- TODO `drizzle/0085_odoo_installation_idempotency.sql`
- TODO `drizzle/0086_printer_identity_and_api_key_deletion.sql`
- TODO `drizzle/0087_odoo_auto_enrollment.sql`
- TODO `drizzle/0088_retire_e2e_capture.sql`
- TODO `drizzle/0089_invitation_verification_binding.sql`
- TODO `drizzle/0090_platform_mfa_sessions.sql`
- TODO `drizzle/0091_workspace_session_security.sql`
- TODO `drizzle/0092_workspace_mfa.sql`
- TODO `drizzle/0093_password_only_authentication.sql`
- TODO `drizzle/0094_printer_operational_verification.sql`
- TODO `drizzle/0095_manual_subscriptions.sql`
- TODO `drizzle/0096_retire_limited_workspace_roles.sql`
- TODO `drizzle/0097_agent_scoped_discovery_identity.sql`
- TODO `drizzle/0098_manual_only_billing.sql`
- TODO `drizzle/0099_subscription_approval_terms.sql`
- TODO `drizzle/0100_plan_prices.sql`
- TODO `drizzle/0101_rolling_print_allowance.sql`
- TODO `drizzle/0102_calendar_month_print_allowance.sql`

### `drizzle/meta` — 35 files

**Logic:** Immutable Drizzle metadata, snapshots and migration journal. **Shared contract:** Exactly one ordered forward SQL migration per journal entry. **Inconsistencies / fix & next check:** Verify journal and SQL parity on latest main; never rewrite applied migrations.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `drizzle/meta/0000_snapshot.json`
- TODO `drizzle/meta/0028_snapshot.json`
- TODO `drizzle/meta/0071_remove_print_job_rate_limits_snapshot.json`
- TODO `drizzle/meta/0072_tenant_scoped_printer_identity_snapshot.json`
- TODO `drizzle/meta/0073_refresh_tokens_snapshot.json`
- TODO `drizzle/meta/0074_token_cascade_cleanup_snapshot.json`
- TODO `drizzle/meta/0075_discovery_checks_cleanup_snapshot.json`
- TODO `drizzle/meta/0076_discovery_candidate_status_check_snapshot.json`
- TODO `drizzle/meta/0077_agent_inventory_snapshots_snapshot.json`
- TODO `drizzle/meta/0078_hot_path_query_indexes_snapshot.json`
- TODO `drizzle/meta/0079_team_collection_pagination_indexes_snapshot.json`
- TODO `drizzle/meta/0080_inventory_snapshot_version_snapshot.json`
- TODO `drizzle/meta/0081_physical_printers_only_snapshot.json`
- TODO `drizzle/meta/0082_audit_repairs_and_maintenance_indexes_snapshot.json`
- TODO `drizzle/meta/0083_e2e_capture_runs_snapshot.json`
- TODO `drizzle/meta/0084_printer_cloud_sharing_snapshot.json`
- TODO `drizzle/meta/0085_odoo_installation_idempotency_snapshot.json`
- TODO `drizzle/meta/0086_printer_identity_and_api_key_deletion_snapshot.json`
- TODO `drizzle/meta/0087_odoo_auto_enrollment_snapshot.json`
- TODO `drizzle/meta/0088_retire_e2e_capture_snapshot.json`
- TODO `drizzle/meta/0089_invitation_verification_binding_snapshot.json`
- TODO `drizzle/meta/0090_platform_mfa_sessions_snapshot.json`
- TODO `drizzle/meta/0091_workspace_session_security_snapshot.json`
- TODO `drizzle/meta/0092_workspace_mfa_snapshot.json`
- TODO `drizzle/meta/0093_password_only_authentication_snapshot.json`
- TODO `drizzle/meta/0094_printer_operational_verification_snapshot.json`
- TODO `drizzle/meta/0095_manual_subscriptions_snapshot.json`
- TODO `drizzle/meta/0096_retire_limited_workspace_roles_snapshot.json`
- TODO `drizzle/meta/0097_agent_scoped_discovery_identity_snapshot.json`
- TODO `drizzle/meta/0098_manual_only_billing_snapshot.json`
- TODO `drizzle/meta/0099_subscription_approval_terms_snapshot.json`
- TODO `drizzle/meta/0100_plan_prices_snapshot.json`
- TODO `drizzle/meta/0101_rolling_print_allowance_snapshot.json`
- TODO `drizzle/meta/0102_calendar_month_print_allowance_snapshot.json`
- TODO `drizzle/meta/_journal.json`

### `odoo_addons/print_gateway` — 10 files

**Logic:** Odoo module manifest, access rules, controllers, XML data, tests. **Shared contract:** Odoo company isolation, explicit owner installation identity, POS/report delivery. **Inconsistencies / fix & next check:** Full Odoo runtime smoke + real POS hardware NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `odoo_addons/print_gateway/__init__.py`
- TODO `odoo_addons/print_gateway/__manifest__.py`
- TODO `odoo_addons/print_gateway/customer_presentation.py`
- TODO `odoo_addons/print_gateway/idempotency_namespace.py`
- TODO `odoo_addons/print_gateway/pos_retry_policy.py`
- TODO `odoo_addons/print_gateway/print_output.py`
- TODO `odoo_addons/print_gateway/printer_geometry.py`
- TODO `odoo_addons/print_gateway/printer_verification.py`
- TODO `odoo_addons/print_gateway/runtime_clock.py`
- TODO `odoo_addons/print_gateway/runtime_policy.py`

### `odoo_addons/print_gateway/controllers` — 3 files

**Logic:** Odoo controller/wire endpoints. **Shared contract:** Gateway tenant credential, installation identity and idempotency request shape. **Inconsistencies / fix & next check:** ERP integration E2E and deployment compatibility NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `odoo_addons/print_gateway/controllers/__init__.py`
- TODO `odoo_addons/print_gateway/controllers/pos.py`
- TODO `odoo_addons/print_gateway/controllers/runtime_printers.py`

### `odoo_addons/print_gateway/data` — 1 files

**Logic:** Odoo module manifest, access rules, controllers, XML data, tests. **Shared contract:** Odoo company isolation, explicit owner installation identity, POS/report delivery. **Inconsistencies / fix & next check:** Full Odoo runtime smoke + real POS hardware NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `odoo_addons/print_gateway/data/cron.xml`

### `odoo_addons/print_gateway/i18n` — 1 files

**Logic:** ERP Arabic message catalog. **Shared contract:** Semantic parity with Gateway quota errors and physical status. **Inconsistencies / fix & next check:** Localization tests must cover newly introduced msgids.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `odoo_addons/print_gateway/i18n/ar.po`

### `odoo_addons/print_gateway/migrations` — 23 files

**Logic:** Odoo addon versioned migration scripts. **Shared contract:** Preservation of ERP settings/company/job metadata. **Inconsistencies / fix & next check:** Upgrade across real Odoo populated databases NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `odoo_addons/print_gateway/migrations/1.1.0/__init__.py`
- TODO `odoo_addons/print_gateway/migrations/1.1.0/pre-migrate.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.1.1.0/__init__.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.1.1.0/pre-migrate.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.1.0/__init__.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.1.0/post-migrate.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.10.0/__init__.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.10.0/post-migrate.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.14.0/pre-migrate.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.21.0/post-migrate.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.29.0/post-migrate.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.3.0/__init__.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.3.0/post-migrate.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.30.0/pre-migrate.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.4.0/__init__.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.4.0/post-migrate.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.6.0/__init__.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.6.0/post-migrate.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.7.0/__init__.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.7.0/post-migrate.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.8.0/__init__.py`
- TODO `odoo_addons/print_gateway/migrations/19.0.2.8.0/post-migrate.py`
- TODO `odoo_addons/print_gateway/migrations/__init__.py`

### `odoo_addons/print_gateway/models` — 16 files

**Logic:** Odoo POS/report/business record workflows and outbox. **Shared contract:** ERP company ownership, replay conditions, claim/status outcome mapping. **Inconsistencies / fix & next check:** No silent retry on ambiguous receipts; real POS/report printing NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `odoo_addons/print_gateway/models/__init__.py`
- TODO `odoo_addons/print_gateway/models/account_move.py`
- TODO `odoo_addons/print_gateway/models/binding.py`
- TODO `odoo_addons/print_gateway/models/crypto.py`
- TODO `odoo_addons/print_gateway/models/gateway_config.py`
- TODO `odoo_addons/print_gateway/models/gateway_destination.py`
- TODO `odoo_addons/print_gateway/models/gateway_http.py`
- TODO `odoo_addons/print_gateway/models/ir_actions_report.py`
- TODO `odoo_addons/print_gateway/models/pos_order.py`
- TODO `odoo_addons/print_gateway/models/pos_session.py`
- TODO `odoo_addons/print_gateway/models/print_intent.py`
- TODO `odoo_addons/print_gateway/models/print_job.py`
- TODO `odoo_addons/print_gateway/models/print_policy.py`
- TODO `odoo_addons/print_gateway/models/print_router.py`
- TODO `odoo_addons/print_gateway/models/runtime_assignment.py`
- TODO `odoo_addons/print_gateway/models/stock_picking.py`

### `odoo_addons/print_gateway/security` — 2 files

**Logic:** Odoo module manifest, access rules, controllers, XML data, tests. **Shared contract:** Odoo company isolation, explicit owner installation identity, POS/report delivery. **Inconsistencies / fix & next check:** Full Odoo runtime smoke + real POS hardware NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `odoo_addons/print_gateway/security/ir.model.access.csv`
- TODO `odoo_addons/print_gateway/security/security.xml`

### `odoo_addons/print_gateway/static` — 27 files

**Logic:** Odoo browser POS/dashboard JS and localized quota dialogs. **Shared contract:** Gateway error codes, EN/AR, RTL, deferred print status. **Inconsistencies / fix & next check:** Browser-and-device printing E2E NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- BLOCKED `odoo_addons/print_gateway/static/description/icon.png`
- TODO `odoo_addons/print_gateway/static/fonts/OFL.txt`
- BLOCKED `odoo_addons/print_gateway/static/fonts/ibm-plex-sans-arabic-400.ttf`
- BLOCKED `odoo_addons/print_gateway/static/fonts/ibm-plex-sans-arabic-500.ttf`
- BLOCKED `odoo_addons/print_gateway/static/fonts/ibm-plex-sans-arabic-600.ttf`
- BLOCKED `odoo_addons/print_gateway/static/fonts/ibm-plex-sans-arabic-700.ttf`
- BLOCKED `odoo_addons/print_gateway/static/fonts/ibm-plex-sans-variable.ttf`
- TODO `odoo_addons/print_gateway/static/src/components/language_switcher.js`
- TODO `odoo_addons/print_gateway/static/src/components/language_switcher.xml`
- TODO `odoo_addons/print_gateway/static/src/components/runtime_agent_field.js`
- TODO `odoo_addons/print_gateway/static/src/components/runtime_printer_field.js`
- TODO `odoo_addons/print_gateway/static/src/css/receipt_raster.css`
- TODO `odoo_addons/print_gateway/static/src/css/typography_fonts.css`
- TODO `odoo_addons/print_gateway/static/src/css/typography_tokens.css`
- TODO `odoo_addons/print_gateway/static/src/js/async_control.js`
- TODO `odoo_addons/print_gateway/static/src/js/gateway_config_auto_sync.js`
- TODO `odoo_addons/print_gateway/static/src/js/gateway_limit_dialog.js`
- TODO `odoo_addons/print_gateway/static/src/js/operation_recovery.js`
- TODO `odoo_addons/print_gateway/static/src/js/pos_print_router.js`
- TODO `odoo_addons/print_gateway/static/src/js/pos_sale_details_router.js`
- TODO `odoo_addons/print_gateway/static/src/js/printer_geometry.js`
- TODO `odoo_addons/print_gateway/static/src/js/printer_verification.js`
- TODO `odoo_addons/print_gateway/static/src/js/receipt_raster.js`
- TODO `odoo_addons/print_gateway/static/src/js/report_interceptor.js`
- TODO `odoo_addons/print_gateway/static/src/js/tours/binding_cascade_tour.js`
- TODO `odoo_addons/print_gateway/static/src/scss/print_gateway_backend.scss`
- TODO `odoo_addons/print_gateway/static/src/scss/print_gateway_tokens.scss`

### `odoo_addons/print_gateway/tests` — 15 files

**Logic:** Odoo module manifest, access rules, controllers, XML data, tests. **Shared contract:** Odoo company isolation, explicit owner installation identity, POS/report delivery. **Inconsistencies / fix & next check:** Full Odoo runtime smoke + real POS hardware NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `odoo_addons/print_gateway/tests/__init__.py`
- TODO `odoo_addons/print_gateway/tests/printer_fixtures.py`
- TODO `odoo_addons/print_gateway/tests/test_architecture_contract.py`
- TODO `odoo_addons/print_gateway/tests/test_automation_workers.py`
- TODO `odoo_addons/print_gateway/tests/test_branch_activity_visibility.py`
- TODO `odoo_addons/print_gateway/tests/test_branch_runtime_binding.py`
- TODO `odoo_addons/print_gateway/tests/test_control_plane.py`
- TODO `odoo_addons/print_gateway/tests/test_diagnostic_localization.py`
- TODO `odoo_addons/print_gateway/tests/test_durable_identity_security.py`
- TODO `odoo_addons/print_gateway/tests/test_gateway_url_transport.py`
- TODO `odoo_addons/print_gateway/tests/test_intent_recovery.py`
- TODO `odoo_addons/print_gateway/tests/test_migration_upgrade.py`
- TODO `odoo_addons/print_gateway/tests/test_receipt_geometry.py`
- TODO `odoo_addons/print_gateway/tests/test_routing_contract.py`
- TODO `odoo_addons/print_gateway/tests/test_universal_printing.py`

### `odoo_addons/print_gateway/views` — 7 files

**Logic:** Odoo module manifest, access rules, controllers, XML data, tests. **Shared contract:** Odoo company isolation, explicit owner installation identity, POS/report delivery. **Inconsistencies / fix & next check:** Full Odoo runtime smoke + real POS hardware NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `odoo_addons/print_gateway/views/binding_views.xml`
- TODO `odoo_addons/print_gateway/views/gateway_config_views.xml`
- TODO `odoo_addons/print_gateway/views/menu.xml`
- TODO `odoo_addons/print_gateway/views/print_intent_views.xml`
- TODO `odoo_addons/print_gateway/views/print_job_views.xml`
- TODO `odoo_addons/print_gateway/views/print_policy_views.xml`
- TODO `odoo_addons/print_gateway/views/runtime_assignment_views.xml`

### `scripts` — 41 files

**Logic:** DB migration, bootstrap and build/release/acceptance scripts. **Shared contract:** Forward-only migration, CI parity and secret handling. **Inconsistencies / fix & next check:** Never run operations against production without backup/approval.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `scripts/audit-gate.mjs`
- TODO `scripts/audit-runtime-privileges.sql`
- TODO `scripts/bootstrap-platform-owner.ts`
- TODO `scripts/build-web-fonts.py`
- TODO `scripts/build-windows-installer.ps1`
- TODO `scripts/check-codeql-sarif.py`
- TODO `scripts/check-compose-build-contexts.py`
- TODO `scripts/check-db-docs.py`
- TODO `scripts/check-i18n.ts`
- TODO `scripts/check-native-backports.py`
- TODO `scripts/check-odoo-translations.py`
- TODO `scripts/check-proxy-boundary.py`
- TODO `scripts/check-public-gateway.mjs`
- TODO `scripts/check-trivy-baseline.py`
- TODO `scripts/check-typography-tokens.py`
- TODO `scripts/check-ui-copy.py`
- TODO `scripts/ci-change-scopes.sh`
- TODO `scripts/ci-postgres.sh`
- TODO `scripts/count-ignored-results.sh`
- TODO `scripts/db-generate.ts`
- TODO `scripts/db-migrate.ts`
- TODO `scripts/deploy-compose.sh`
- TODO `scripts/generate-icons.mjs`
- TODO `scripts/odoo-hardened-entrypoint.py`
- TODO `scripts/odoo-healthcheck.py`
- TODO `scripts/pg-concurrent-claim.sh`
- TODO `scripts/pg-notify-failure-injection.ts`
- TODO `scripts/postgres-backup.sh`
- TODO `scripts/postgres-restore.sh`
- TODO `scripts/postgres-role-profile.mjs`
- TODO `scripts/print-latency-report.mjs`
- TODO `scripts/provision-plans.ts`
- TODO `scripts/restore_v5_original_font_assets.py`
- TODO `scripts/setup-tauri-linux.sh`
- TODO `scripts/smoke-test-windows.ps1`
- TODO `scripts/test-native-macro-diagnostics.py`
- TODO `scripts/verify-common-passwords.py`
- TODO `scripts/verify-fresh-source.sh`
- TODO `scripts/verify-npm-audit-fixture.mjs`
- TODO `scripts/verify-odoo-test-results.py`
- TODO `scripts/verify-windows-release.ps1`

### `scripts/acceptance` — 23 files

**Logic:** Production-like test/soak harnesses. **Shared contract:** Gateway/Odoo/Agent/DB job+receipt shapes. **Inconsistencies / fix & next check:** External staging/live printers NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `scripts/acceptance/Caddyfile`
- TODO `scripts/acceptance/cgroup-memory.cjs`
- TODO `scripts/acceptance/container-release.py`
- TODO `scripts/acceptance/coop-browser.mts`
- TODO `scripts/acceptance/csp-report-browser.mts`
- TODO `scripts/acceptance/gateway-memory-probe.cjs`
- TODO `scripts/acceptance/gateway-soak-accounting.mjs`
- TODO `scripts/acceptance/gateway-soak-payloads.mjs`
- TODO `scripts/acceptance/gateway-soak-source.mjs`
- TODO `scripts/acceptance/gateway-soak.mjs`
- TODO `scripts/acceptance/manual-admin-accessibility-browser.mjs`
- TODO `scripts/acceptance/manual-admin-browser.mjs`
- TODO `scripts/acceptance/manual-customer-browser.mjs`
- TODO `scripts/acceptance/odoo-receipt-browser.mjs`
- TODO `scripts/acceptance/odoo-standard-page-browser.mjs`
- TODO `scripts/acceptance/platform-browser.mjs`
- TODO `scripts/acceptance/postgres-restore-drill.mjs`
- TODO `scripts/acceptance/postgres-roles.mjs`
- TODO `scripts/acceptance/provision-windows-acceptance.ps1`
- TODO `scripts/acceptance/registration-transport.fixture.mjs`
- TODO `scripts/acceptance/summarize-gateway-heaps.py`
- TODO `scripts/acceptance/verify-odoo-receipt-codes.py`
- TODO `scripts/acceptance/workspace-browser.mjs`

### `scripts/lint` — 1 files

**Logic:** DB migration, bootstrap and build/release/acceptance scripts. **Shared contract:** Forward-only migration, CI parity and secret handling. **Inconsistencies / fix & next check:** Never run operations against production without backup/approval.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `scripts/lint/react-deprecations.mjs`

### `security` — 7 files

**Logic:** Security policies, allowlists and scanning configuration. **Shared contract:** Auth, image vulnerability exceptions and CI gates. **Inconsistencies / fix & next check:** Review baseline exceptions and live secrets handling regularly.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `security/CROSS_ORIGIN_OPENER_POLICY.md`
- TODO `security/CSP_REPORTING.md`
- TODO `security/PASSWORD_SCREENING.md`
- TODO `security/common-passwords-LICENSE.txt`
- TODO `security/common-passwords-provenance.json`
- TODO `security/image-vulnerability-baseline.json`
- TODO `security/odoo19-image-review-2026-10-26.md`

### `src-tauri` — 6 files

**Logic:** Tauri packaging, Windows installer, native and vendor deps. **Shared contract:** Go Agent lifecycle/IPC authentication, desktop file output. **Inconsistencies / fix & next check:** Windows build success != installation/recovery and physical printing.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src-tauri/Cargo.lock`
- TODO `src-tauri/Cargo.toml`
- TODO `src-tauri/build.rs`
- TODO `src-tauri/installer_hooks.nsh`
- TODO `src-tauri/rust-toolchain.toml`
- TODO `src-tauri/tauri.conf.json`

### `src-tauri/capabilities` — 1 files

**Logic:** Tauri packaging, Windows installer, native and vendor deps. **Shared contract:** Go Agent lifecycle/IPC authentication, desktop file output. **Inconsistencies / fix & next check:** Windows build success != installation/recovery and physical printing.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src-tauri/capabilities/default.json`

### `src-tauri/icons` — 10 files

**Logic:** Tauri packaging, Windows installer, native and vendor deps. **Shared contract:** Go Agent lifecycle/IPC authentication, desktop file output. **Inconsistencies / fix & next check:** Windows build success != installation/recovery and physical printing.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- BLOCKED `src-tauri/icons/128x128.png`
- BLOCKED `src-tauri/icons/128x128@2x.png`
- BLOCKED `src-tauri/icons/16x16.png`
- BLOCKED `src-tauri/icons/24x24.png`
- BLOCKED `src-tauri/icons/32x32.png`
- BLOCKED `src-tauri/icons/48x48.png`
- BLOCKED `src-tauri/icons/64x64.png`
- TODO `src-tauri/icons/icon-source.svg`
- BLOCKED `src-tauri/icons/icon.ico`
- BLOCKED `src-tauri/icons/icon.png`

### `src-tauri/native-regressions` — 2 files

**Logic:** Tauri packaging, Windows installer, native and vendor deps. **Shared contract:** Go Agent lifecycle/IPC authentication, desktop file output. **Inconsistencies / fix & next check:** Windows build success != installation/recovery and physical printing.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src-tauri/native-regressions/Cargo.lock`
- TODO `src-tauri/native-regressions/Cargo.toml`

### `src-tauri/native-regressions/src` — 1 files

**Logic:** Tauri packaging, Windows installer, native and vendor deps. **Shared contract:** Go Agent lifecycle/IPC authentication, desktop file output. **Inconsistencies / fix & next check:** Windows build success != installation/recovery and physical printing.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src-tauri/native-regressions/src/lib.rs`

### `src-tauri/src` — 9 files

**Logic:** Tauri/Rust IPC and desktop bridge. **Shared contract:** Gateway/Agent session, printer metadata and state vocabulary. **Inconsistencies / fix & next check:** Native desktop/Windows UI session test NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src-tauri/src/agent.rs`
- TODO `src-tauri/src/agent_status.rs`
- TODO `src-tauri/src/audit_discovery_test.rs`
- TODO `src-tauri/src/cleanup.rs`
- TODO `src-tauri/src/commands.rs`
- TODO `src-tauri/src/logging.rs`
- TODO `src-tauri/src/main.rs`
- TODO `src-tauri/src/paths.rs`
- TODO `src-tauri/src/tray.rs`

### `src-tauri/tests` — 1 files

**Logic:** Tauri packaging, Windows installer, native and vendor deps. **Shared contract:** Go Agent lifecycle/IPC authentication, desktop file output. **Inconsistencies / fix & next check:** Windows build success != installation/recovery and physical printing.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src-tauri/tests/audit_logging.rs`

### `src-tauri/vendor` — 2 files

**Logic:** Vendored Rust/GTK compatibility source and patchsets. **Shared contract:** Pinned hashes/native build and platform security. **Inconsistencies / fix & next check:** Separate third-party vulnerability scan and native runtime validation needed.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src-tauri/vendor/PROVENANCE.json`
- TODO `src-tauri/vendor/README.md`

### `src-tauri/vendor/glib` — 121 files

**Logic:** Vendored Rust/GTK compatibility source and patchsets. **Shared contract:** Pinned hashes/native build and platform security. **Inconsistencies / fix & next check:** Separate third-party vulnerability scan and native runtime validation needed.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src-tauri/vendor/glib/.cargo_vcs_info.json`
- TODO `src-tauri/vendor/glib/COPYRIGHT`
- TODO `src-tauri/vendor/glib/Cargo.toml`
- TODO `src-tauri/vendor/glib/Cargo.toml.orig`
- TODO `src-tauri/vendor/glib/Gir.toml`
- TODO `src-tauri/vendor/glib/Gir_GObject.toml`
- TODO `src-tauri/vendor/glib/LICENSE`
- TODO `src-tauri/vendor/glib/README.md`
- TODO `src-tauri/vendor/glib/benches/gstring.rs`
- TODO `src-tauri/vendor/glib/src/auto/alias.rs`
- TODO `src-tauri/vendor/glib/src/auto/checksum.rs`
- TODO `src-tauri/vendor/glib/src/auto/constants.rs`
- TODO `src-tauri/vendor/glib/src/auto/date_time.rs`
- TODO `src-tauri/vendor/glib/src/auto/enums.rs`
- TODO `src-tauri/vendor/glib/src/auto/flags.rs`
- TODO `src-tauri/vendor/glib/src/auto/functions.rs`
- TODO `src-tauri/vendor/glib/src/auto/key_file.rs`
- TODO `src-tauri/vendor/glib/src/auto/main_context.rs`
- TODO `src-tauri/vendor/glib/src/auto/main_loop.rs`
- TODO `src-tauri/vendor/glib/src/auto/markup_parse_context.rs`
- TODO `src-tauri/vendor/glib/src/auto/mod.rs`
- TODO `src-tauri/vendor/glib/src/auto/source.rs`
- TODO `src-tauri/vendor/glib/src/auto/time_zone.rs`
- TODO `src-tauri/vendor/glib/src/auto/uri.rs`
- TODO `src-tauri/vendor/glib/src/auto/versions.txt`
- TODO `src-tauri/vendor/glib/src/boxed.rs`
- TODO `src-tauri/vendor/glib/src/boxed_any_object.rs`
- TODO `src-tauri/vendor/glib/src/boxed_inline.rs`
- TODO `src-tauri/vendor/glib/src/bridged_logging.rs`
- TODO `src-tauri/vendor/glib/src/byte_array.rs`
- TODO `src-tauri/vendor/glib/src/bytes.rs`
- TODO `src-tauri/vendor/glib/src/char.rs`
- TODO `src-tauri/vendor/glib/src/checksum.rs`
- TODO `src-tauri/vendor/glib/src/clone.rs`
- TODO `src-tauri/vendor/glib/src/closure.rs`
- TODO `src-tauri/vendor/glib/src/collections/list.rs`
- TODO `src-tauri/vendor/glib/src/collections/mod.rs`
- TODO `src-tauri/vendor/glib/src/collections/ptr_slice.rs`
- TODO `src-tauri/vendor/glib/src/collections/slice.rs`
- TODO `src-tauri/vendor/glib/src/collections/slist.rs`
- TODO `src-tauri/vendor/glib/src/collections/strv.rs`
- TODO `src-tauri/vendor/glib/src/control_flow.rs`
- TODO `src-tauri/vendor/glib/src/convert.rs`
- TODO `src-tauri/vendor/glib/src/date.rs`
- TODO `src-tauri/vendor/glib/src/date_time.rs`
- TODO `src-tauri/vendor/glib/src/enums.rs`
- TODO `src-tauri/vendor/glib/src/error.rs`
- TODO `src-tauri/vendor/glib/src/exit_code.rs`
- TODO `src-tauri/vendor/glib/src/future_with_timeout.rs`
- TODO `src-tauri/vendor/glib/src/gobject/auto/binding.rs`
- TODO `src-tauri/vendor/glib/src/gobject/auto/binding_group.rs`
- TODO `src-tauri/vendor/glib/src/gobject/auto/flags.rs`
- TODO `src-tauri/vendor/glib/src/gobject/auto/mod.rs`
- TODO `src-tauri/vendor/glib/src/gobject/auto/signal_group.rs`
- TODO `src-tauri/vendor/glib/src/gobject/binding.rs`
- TODO `src-tauri/vendor/glib/src/gobject/binding_group.rs`
- TODO `src-tauri/vendor/glib/src/gobject/flags.rs`
- TODO `src-tauri/vendor/glib/src/gobject/mod.rs`
- TODO `src-tauri/vendor/glib/src/gobject/signal_group.rs`
- TODO `src-tauri/vendor/glib/src/gstring.rs`
- TODO `src-tauri/vendor/glib/src/gstring_builder.rs`
- TODO `src-tauri/vendor/glib/src/key_file.rs`
- TODO `src-tauri/vendor/glib/src/lib.rs`
- TODO `src-tauri/vendor/glib/src/log.rs`
- TODO `src-tauri/vendor/glib/src/main_context.rs`
- TODO `src-tauri/vendor/glib/src/main_context_channel.rs`
- TODO `src-tauri/vendor/glib/src/main_context_futures.rs`
- TODO `src-tauri/vendor/glib/src/manual_functions.rs`
- TODO `src-tauri/vendor/glib/src/object.rs`
- TODO `src-tauri/vendor/glib/src/param_spec.rs`
- TODO `src-tauri/vendor/glib/src/prelude.rs`
- TODO `src-tauri/vendor/glib/src/property.rs`
- TODO `src-tauri/vendor/glib/src/quark.rs`
- TODO `src-tauri/vendor/glib/src/shared.rs`
- TODO `src-tauri/vendor/glib/src/signal.rs`
- TODO `src-tauri/vendor/glib/src/source.rs`
- TODO `src-tauri/vendor/glib/src/source_futures.rs`
- TODO `src-tauri/vendor/glib/src/subclass/basic.rs`
- TODO `src-tauri/vendor/glib/src/subclass/boxed.rs`
- TODO `src-tauri/vendor/glib/src/subclass/interface.rs`
- TODO `src-tauri/vendor/glib/src/subclass/mod.rs`
- TODO `src-tauri/vendor/glib/src/subclass/object.rs`
- TODO `src-tauri/vendor/glib/src/subclass/object_impl_ref.rs`
- TODO `src-tauri/vendor/glib/src/subclass/shared.rs`
- TODO `src-tauri/vendor/glib/src/subclass/signal.rs`
- TODO `src-tauri/vendor/glib/src/subclass/types.rs`
- TODO `src-tauri/vendor/glib/src/thread_guard.rs`
- TODO `src-tauri/vendor/glib/src/thread_pool.rs`
- TODO `src-tauri/vendor/glib/src/time_span.rs`
- TODO `src-tauri/vendor/glib/src/time_zone.rs`
- TODO `src-tauri/vendor/glib/src/translate.rs`
- TODO `src-tauri/vendor/glib/src/types.rs`
- TODO `src-tauri/vendor/glib/src/unichar.rs`
- TODO `src-tauri/vendor/glib/src/unicollate.rs`
- TODO `src-tauri/vendor/glib/src/utils.rs`
- TODO `src-tauri/vendor/glib/src/value.rs`
- TODO `src-tauri/vendor/glib/src/value_array.rs`
- TODO `src-tauri/vendor/glib/src/variant.rs`
- TODO `src-tauri/vendor/glib/src/variant_dict.rs`
- TODO `src-tauri/vendor/glib/src/variant_iter.rs`
- TODO `src-tauri/vendor/glib/src/variant_type.rs`
- TODO `src-tauri/vendor/glib/src/win32.rs`
- TODO `src-tauri/vendor/glib/src/wrapper.rs`
- TODO `src-tauri/vendor/glib/tests/check_gir.rs`
- TODO `src-tauri/vendor/glib/tests/clone.rs`
- TODO `src-tauri/vendor/glib/tests/derive.rs`
- TODO `src-tauri/vendor/glib/tests/log.rs`
- TODO `src-tauri/vendor/glib/tests/print.rs`
- TODO `src-tauri/vendor/glib/tests/structured_log.rs`
- TODO `src-tauri/vendor/glib/tests/subclass_compiletest.rs`
- TODO `src-tauri/vendor/glib/tests/subclass_compiletest/01-auto-send-sync.rs`
- TODO `src-tauri/vendor/glib/tests/subclass_compiletest/02-no-auto-send-sync.rs`
- TODO `src-tauri/vendor/glib/tests/subclass_compiletest/02-no-auto-send-sync.stderr`
- TODO `src-tauri/vendor/glib/tests/subclass_compiletest/03-object-no-auto-send-sync.rs`
- TODO `src-tauri/vendor/glib/tests/subclass_compiletest/03-object-no-auto-send-sync.stderr`
- TODO `src-tauri/vendor/glib/tests/subclass_compiletest/04-auto-send-sync-with-send-sync-parent.rs`
- TODO `src-tauri/vendor/glib/tests/subclass_compiletest/05-no-auto-send-sync-with-non-send-sync-parent.rs`
- TODO `src-tauri/vendor/glib/tests/subclass_compiletest/05-no-auto-send-sync-with-non-send-sync-parent.stderr`
- TODO `src-tauri/vendor/glib/tests/subclass_compiletest/06-no-auto-send-sync-with-non-send-sync-ffi-parent.rs`
- TODO `src-tauri/vendor/glib/tests/subclass_compiletest/06-no-auto-send-sync-with-non-send-sync-ffi-parent.stderr`
- TODO `src-tauri/vendor/glib/tests/value.rs`

### `src-tauri/vendor/glib-macros` — 28 files

**Logic:** Vendored Rust/GTK compatibility source and patchsets. **Shared contract:** Pinned hashes/native build and platform security. **Inconsistencies / fix & next check:** Separate third-party vulnerability scan and native runtime validation needed.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src-tauri/vendor/glib-macros/.cargo_vcs_info.json`
- TODO `src-tauri/vendor/glib-macros/COPYRIGHT`
- TODO `src-tauri/vendor/glib-macros/Cargo.toml`
- TODO `src-tauri/vendor/glib-macros/Cargo.toml.orig`
- TODO `src-tauri/vendor/glib-macros/LICENSE`
- TODO `src-tauri/vendor/glib-macros/src/boxed_derive.rs`
- TODO `src-tauri/vendor/glib-macros/src/clone.rs`
- TODO `src-tauri/vendor/glib-macros/src/closure.rs`
- TODO `src-tauri/vendor/glib-macros/src/derived_properties_attribute.rs`
- TODO `src-tauri/vendor/glib-macros/src/downgrade_derive/enums.rs`
- TODO `src-tauri/vendor/glib-macros/src/downgrade_derive/fields.rs`
- TODO `src-tauri/vendor/glib-macros/src/downgrade_derive/mod.rs`
- TODO `src-tauri/vendor/glib-macros/src/downgrade_derive/structs.rs`
- TODO `src-tauri/vendor/glib-macros/src/enum_derive.rs`
- TODO `src-tauri/vendor/glib-macros/src/error_domain_derive.rs`
- TODO `src-tauri/vendor/glib-macros/src/flags_attribute.rs`
- TODO `src-tauri/vendor/glib-macros/src/lib.rs`
- TODO `src-tauri/vendor/glib-macros/src/object_interface_attribute.rs`
- TODO `src-tauri/vendor/glib-macros/src/object_subclass_attribute.rs`
- TODO `src-tauri/vendor/glib-macros/src/properties.rs`
- TODO `src-tauri/vendor/glib-macros/src/shared_boxed_derive.rs`
- TODO `src-tauri/vendor/glib-macros/src/utils.rs`
- TODO `src-tauri/vendor/glib-macros/src/value_delegate_derive.rs`
- TODO `src-tauri/vendor/glib-macros/src/variant_derive.rs`
- TODO `src-tauri/vendor/glib-macros/tests/clone.rs`
- TODO `src-tauri/vendor/glib-macros/tests/properties.rs`
- TODO `src-tauri/vendor/glib-macros/tests/test.rs`
- TODO `src-tauri/vendor/glib-macros/tests/value_delegate_derive.rs`

### `src-tauri/vendor/gtk3-macros` — 9 files

**Logic:** Vendored Rust/GTK compatibility source and patchsets. **Shared contract:** Pinned hashes/native build and platform security. **Inconsistencies / fix & next check:** Separate third-party vulnerability scan and native runtime validation needed.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src-tauri/vendor/gtk3-macros/.cargo_vcs_info.json`
- TODO `src-tauri/vendor/gtk3-macros/COPYRIGHT`
- TODO `src-tauri/vendor/gtk3-macros/Cargo.toml`
- TODO `src-tauri/vendor/gtk3-macros/Cargo.toml.orig`
- TODO `src-tauri/vendor/gtk3-macros/LICENSE`
- TODO `src-tauri/vendor/gtk3-macros/src/attribute_parser.rs`
- TODO `src-tauri/vendor/gtk3-macros/src/composite_template_derive.rs`
- TODO `src-tauri/vendor/gtk3-macros/src/lib.rs`
- TODO `src-tauri/vendor/gtk3-macros/src/util.rs`

### `src-tauri/vendor/patches` — 2 files

**Logic:** Vendored Rust/GTK compatibility source and patchsets. **Shared contract:** Pinned hashes/native build and platform security. **Inconsistencies / fix & next check:** Separate third-party vulnerability scan and native runtime validation needed.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src-tauri/vendor/patches/glib-variant-str-iterator.patch`
- TODO `src-tauri/vendor/patches/native-syn-diagnostics.patch`

### `src/app` — 8 files

**Logic:** Next.js Gateway pages and authentication flows. **Shared contract:** Password-only, invitation join same tenant, owner-only billing. **Inconsistencies / fix & next check:** End-to-end browser session and Arabic RTL NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/actions.ts`
- TODO `src/app/error.tsx`
- TODO `src/app/globals.css`
- TODO `src/app/icon.svg`
- TODO `src/app/layout.tsx`
- TODO `src/app/loading.tsx`
- TODO `src/app/not-found.tsx`
- TODO `src/app/page.tsx`

### `src/app/api` — 107 files

**Logic:** Next.js Gateway API route handlers. **Shared contract:** Tenant/company ownership, origin, auth, pagination, input/error shape, DB idempotency. **Inconsistencies / fix & next check:** Every route needs per-boundary tenant and authorization review.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/api/admin/tenants/[id]/lifecycle/route.ts`
- TODO `src/app/api/agent/desired-state/route.ts`
- TODO `src/app/api/agent/discovery/route.ts`
- TODO `src/app/api/agent/heartbeat/route.ts`
- TODO `src/app/api/agent/jobs/route.ts`
- TODO `src/app/api/agent/probe/route.ts`
- TODO `src/app/api/agent/register/route.ts`
- TODO `src/app/api/agents/[id]/discovered-printers/[deviceId]/provision/route.ts`
- TODO `src/app/api/agents/[id]/discovered-printers/[deviceId]/verify/route.ts`
- TODO `src/app/api/agents/[id]/discovery/[discoveryId]/cancel/route.ts`
- TODO `src/app/api/agents/[id]/discovery/[discoveryId]/route.ts`
- TODO `src/app/api/agents/[id]/discovery/route.ts`
- TODO `src/app/api/agents/[id]/route.ts`
- TODO `src/app/api/agents/health/route.ts`
- TODO `src/app/api/agents/route.ts`
- TODO `src/app/api/agents/service-status/route.ts`
- TODO `src/app/api/auth/activity/route.ts`
- TODO `src/app/api/auth/forgot-password/route.ts`
- TODO `src/app/api/auth/login/route.ts`
- TODO `src/app/api/auth/logout/route.ts`
- TODO `src/app/api/auth/manager/login/route.ts`
- TODO `src/app/api/auth/manager/logout/route.ts`
- TODO `src/app/api/auth/manager/me/route.ts`
- TODO `src/app/api/auth/manager/refresh/route.ts`
- TODO `src/app/api/auth/me/route.ts`
- TODO `src/app/api/auth/reauth/password/route.ts`
- TODO `src/app/api/auth/reauth/status/route.ts`
- TODO `src/app/api/auth/refresh/route.ts`
- TODO `src/app/api/auth/register/route.ts`
- TODO `src/app/api/auth/resend-verification/route.ts`
- TODO `src/app/api/auth/reset-password/route.ts`
- TODO `src/app/api/auth/select-tenant/route.ts`
- TODO `src/app/api/auth/sessions/route.ts`
- TODO `src/app/api/auth/verify-email/route.ts`
- TODO `src/app/api/billing/cancel/route.ts`
- TODO `src/app/api/billing/checkout/route.ts`
- TODO `src/app/api/billing/plans/route.ts`
- TODO `src/app/api/billing/portal/route.ts`
- TODO `src/app/api/billing/resume/route.ts`
- TODO `src/app/api/billing/status/route.ts`
- TODO `src/app/api/billing/usage/route.ts`
- TODO `src/app/api/billing/webhook/route.ts`
- TODO `src/app/api/health/route.ts`
- TODO `src/app/api/jobs/[id]/reprint/route.ts`
- TODO `src/app/api/jobs/[id]/route.ts`
- TODO `src/app/api/jobs/[id]/timeline/route.ts`
- TODO `src/app/api/jobs/route.ts`
- TODO `src/app/api/live/route.ts`
- TODO `src/app/api/metrics/route.ts`
- TODO `src/app/api/odoo/agents/route.ts`
- TODO `src/app/api/odoo/configuration/route.ts`
- TODO `src/app/api/odoo/health/route.ts`
- TODO `src/app/api/odoo/installations/auto/route.ts`
- TODO `src/app/api/odoo/installations/cutover/route.ts`
- TODO `src/app/api/odoo/installations/resolutions/route.ts`
- TODO `src/app/api/odoo/installations/route.ts`
- TODO `src/app/api/odoo/keys/[id]/rotate/route.ts`
- TODO `src/app/api/odoo/keys/route.ts`
- TODO `src/app/api/odoo/printers/route.ts`
- TODO `src/app/api/onboarding/route.ts`
- TODO `src/app/api/platform/audit/route.ts`
- TODO `src/app/api/platform/auth/login/route.ts`
- TODO `src/app/api/platform/auth/logout/route.ts`
- TODO `src/app/api/platform/auth/me/route.ts`
- TODO `src/app/api/platform/auth/reauth/route.ts`
- TODO `src/app/api/platform/auth/refresh/route.ts`
- TODO `src/app/api/platform/auth/sessions/route.ts`
- TODO `src/app/api/platform/database/route.ts`
- TODO `src/app/api/platform/fleet/delete/route.ts`
- TODO `src/app/api/platform/fleet/lifecycle/route.ts`
- TODO `src/app/api/platform/fleet/route.ts`
- TODO `src/app/api/platform/integrations/quarantine/route.ts`
- TODO `src/app/api/platform/integrations/remove/route.ts`
- TODO `src/app/api/platform/integrations/revoke/route.ts`
- TODO `src/app/api/platform/integrations/route.ts`
- TODO `src/app/api/platform/jobs/route.ts`
- TODO `src/app/api/platform/plans/[id]/route.ts`
- TODO `src/app/api/platform/plans/route.ts`
- TODO `src/app/api/platform/stats/route.ts`
- TODO `src/app/api/platform/subscription-requests/route.ts`
- TODO `src/app/api/platform/subscriptions/route.ts`
- TODO `src/app/api/platform/tenants/[id]/delete/route.ts`
- TODO `src/app/api/platform/tenants/[id]/invitations/route.ts`
- TODO `src/app/api/platform/tenants/[id]/members/route.ts`
- TODO `src/app/api/platform/tenants/[id]/ownership/route.ts`
- TODO `src/app/api/platform/tenants/[id]/reactivate/route.ts`
- TODO `src/app/api/platform/tenants/[id]/route.ts`
- TODO `src/app/api/platform/tenants/[id]/subscription/route.ts`
- TODO `src/app/api/platform/tenants/[id]/suspend/route.ts`
- TODO `src/app/api/platform/tenants/route.ts`
- TODO `src/app/api/print/jobs/batch-status/route.ts`
- TODO `src/app/api/print/jobs/route.ts`
- TODO `src/app/api/print/jobs/v2/route.ts`
- TODO `src/app/api/printers/[id]/certify/route.ts`
- TODO `src/app/api/printers/[id]/route.ts`
- TODO `src/app/api/printers/[id]/test-connection/route.ts`
- TODO `src/app/api/printers/[id]/test-print/route.ts`
- TODO `src/app/api/printers/capabilities/route.ts`
- TODO `src/app/api/printers/route.ts`
- TODO `src/app/api/security/csp-report/route.ts`
- TODO `src/app/api/settings/route.ts`
- TODO `src/app/api/subscription-requests/route.ts`
- TODO `src/app/api/team/invitations/accept/route.ts`
- TODO `src/app/api/team/invitations/preview/route.ts`
- TODO `src/app/api/team/invitations/route.ts`
- TODO `src/app/api/team/members/route.ts`
- TODO `src/app/api/team/ownership/route.ts`

### `src/app/api-keys` — 1 files

**Logic:** Next.js Gateway API route handlers. **Shared contract:** Tenant/company ownership, origin, auth, pagination, input/error shape, DB idempotency. **Inconsistencies / fix & next check:** Every route needs per-boundary tenant and authorization review.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/api-keys/page.tsx`

### `src/app/billing` — 1 files

**Logic:** Customer plan/usage view and manual request. **Shared contract:** Contract dates independent of UTC monthly admission counter. **Inconsistencies / fix & next check:** No auto renewal; no exposing private data to Full Access.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/billing/page.tsx`

### `src/app/dashboard` — 2 files

**Logic:** Customer dashboard, printer and jobs UX. **Shared contract:** Canonical status/physical evidence and locale. **Inconsistencies / fix & next check:** Rerender/RTL and concurrent refresh tests required.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/dashboard/dashboard-client.tsx`
- TODO `src/app/dashboard/page.tsx`

### `src/app/fonts` — 11 files

**Logic:** Next.js Gateway pages and authentication flows. **Shared contract:** Password-only, invitation join same tenant, owner-only billing. **Inconsistencies / fix & next check:** End-to-end browser session and Arabic RTL NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/fonts/OFL.txt`
- BLOCKED `src/app/fonts/ibm-plex-sans-arabic-400.ttf`
- BLOCKED `src/app/fonts/ibm-plex-sans-arabic-400.woff2`
- BLOCKED `src/app/fonts/ibm-plex-sans-arabic-500.ttf`
- BLOCKED `src/app/fonts/ibm-plex-sans-arabic-500.woff2`
- BLOCKED `src/app/fonts/ibm-plex-sans-arabic-600.ttf`
- BLOCKED `src/app/fonts/ibm-plex-sans-arabic-600.woff2`
- BLOCKED `src/app/fonts/ibm-plex-sans-arabic-700.ttf`
- BLOCKED `src/app/fonts/ibm-plex-sans-arabic-700.woff2`
- BLOCKED `src/app/fonts/ibm-plex-sans-variable.ttf`
- BLOCKED `src/app/fonts/ibm-plex-sans-variable.woff2`

### `src/app/forgot-password` — 1 files

**Logic:** Next.js Gateway pages and authentication flows. **Shared contract:** Password-only, invitation join same tenant, owner-only billing. **Inconsistencies / fix & next check:** End-to-end browser session and Arabic RTL NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/forgot-password/page.tsx`

### `src/app/invite` — 1 files

**Logic:** Next.js Gateway pages and authentication flows. **Shared contract:** Password-only, invitation join same tenant, owner-only billing. **Inconsistencies / fix & next check:** End-to-end browser session and Arabic RTL NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/invite/page.tsx`

### `src/app/login` — 1 files

**Logic:** Next.js Gateway pages and authentication flows. **Shared contract:** Password-only, invitation join same tenant, owner-only billing. **Inconsistencies / fix & next check:** End-to-end browser session and Arabic RTL NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/login/page.tsx`

### `src/app/onboarding` — 1 files

**Logic:** Next.js Gateway pages and authentication flows. **Shared contract:** Password-only, invitation join same tenant, owner-only billing. **Inconsistencies / fix & next check:** End-to-end browser session and Arabic RTL NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/onboarding/page.tsx`

### `src/app/platform` — 18 files

**Logic:** Platform Owner admin screens and operation management. **Shared contract:** Manual approval and effective active-subscription state. **Inconsistencies / fix & next check:** UI/API status consistent with live DB admission predicate.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/platform/audit/page.tsx`
- TODO `src/app/platform/dashboard/page.tsx`
- TODO `src/app/platform/database/page.tsx`
- TODO `src/app/platform/fleet/page.tsx`
- TODO `src/app/platform/integrations/page.tsx`
- TODO `src/app/platform/jobs/page.tsx`
- TODO `src/app/platform/layout.tsx`
- TODO `src/app/platform/login/page.tsx`
- TODO `src/app/platform/operations/page.tsx`
- TODO `src/app/platform/page.tsx`
- TODO `src/app/platform/plans/page.tsx`
- TODO `src/app/platform/release-readiness/page.tsx`
- TODO `src/app/platform/release-readiness/release-readiness-client.tsx`
- TODO `src/app/platform/security/page.tsx`
- TODO `src/app/platform/subscription-requests/page.tsx`
- TODO `src/app/platform/subscriptions/page.tsx`
- TODO `src/app/platform/tenants/[id]/page.tsx`
- TODO `src/app/platform/tenants/page.tsx`

### `src/app/pricing` — 1 files

**Logic:** Next.js Gateway pages and authentication flows. **Shared contract:** Password-only, invitation join same tenant, owner-only billing. **Inconsistencies / fix & next check:** End-to-end browser session and Arabic RTL NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/pricing/page.tsx`

### `src/app/reset-password` — 1 files

**Logic:** Next.js Gateway pages and authentication flows. **Shared contract:** Password-only, invitation join same tenant, owner-only billing. **Inconsistencies / fix & next check:** End-to-end browser session and Arabic RTL NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/reset-password/page.tsx`

### `src/app/settings` — 1 files

**Logic:** Next.js Gateway pages and authentication flows. **Shared contract:** Password-only, invitation join same tenant, owner-only billing. **Inconsistencies / fix & next check:** End-to-end browser session and Arabic RTL NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/settings/page.tsx`

### `src/app/signup` — 1 files

**Logic:** Next.js Gateway pages and authentication flows. **Shared contract:** Password-only, invitation join same tenant, owner-only billing. **Inconsistencies / fix & next check:** End-to-end browser session and Arabic RTL NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/signup/page.tsx`

### `src/app/team` — 1 files

**Logic:** Workspace member/invitation UI. **Shared contract:** Tenant role=owner manages invites; Full Access operational only. **Inconsistencies / fix & next check:** Receipt emails/token hashes and invite mutations remain owner-only.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/team/page.tsx`

### `src/app/verify-email` — 1 files

**Logic:** Next.js Gateway pages and authentication flows. **Shared contract:** Password-only, invitation join same tenant, owner-only billing. **Inconsistencies / fix & next check:** End-to-end browser session and Arabic RTL NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/app/verify-email/page.tsx`

### `src/components` — 20 files

**Logic:** UI controls, forms, status and accessibility. **Shared contract:** Client/server error code and translated copy. **Inconsistencies / fix & next check:** Browser cross-RTL interaction NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/components/AppShell.tsx`
- TODO `src/components/AuthShell.tsx`
- TODO `src/components/BillingActions.tsx`
- TODO `src/components/CommandPalette.tsx`
- TODO `src/components/CspStyleNonce.tsx`
- TODO `src/components/JobCleanupButton.tsx`
- TODO `src/components/JobTimeline.tsx`
- TODO `src/components/LanguageSwitcher.tsx`
- TODO `src/components/MobileAppBar.tsx`
- TODO `src/components/PrintCertificationWizard.tsx`
- TODO `src/components/PrinterGeometrySettings.tsx`
- TODO `src/components/PrinterVerificationDetails.tsx`
- TODO `src/components/SessionInventory.tsx`
- TODO `src/components/ThemeToggle.tsx`
- TODO `src/components/TopNavbar.tsx`
- TODO `src/components/UpgradeLimitDialog.tsx`
- TODO `src/components/WorkspaceSecurity.tsx`
- TODO `src/components/brand.tsx`
- TODO `src/components/ui.tsx`
- TODO `src/components/visual-system.tsx`

### `src/components/marketing` — 3 files

**Logic:** UI controls, forms, status and accessibility. **Shared contract:** Client/server error code and translated copy. **Inconsistencies / fix & next check:** Browser cross-RTL interaction NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/components/marketing/LandingMotion.tsx`
- TODO `src/components/marketing/MobileNavigation.tsx`
- TODO `src/components/marketing/SpotlightSurface.tsx`

### `src/components/platform` — 4 files

**Logic:** UI controls, forms, status and accessibility. **Shared contract:** Client/server error code and translated copy. **Inconsistencies / fix & next check:** Browser cross-RTL interaction NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/components/platform/ManualAdmin.tsx`
- TODO `src/components/platform/PlatformSidebar.tsx`
- TODO `src/components/platform/SubscriptionEditor.tsx`
- TODO `src/components/platform/WorkspaceLifecycle.tsx`

### `src/db` — 3 files

**Logic:** Drizzle runtime DB schema/client. **Shared contract:** Immutable SQL migrations, tenant FKs, no destructive reset. **Inconsistencies / fix & next check:** RLS defense-in-depth absent; app-level tenant predicates must be tested.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/db/client.ts`
- TODO `src/db/index.ts`
- TODO `src/db/schema.ts`

### `src/desktop` — 7 files

**Logic:** Desktop React view, IPC and Agent connection. **Shared contract:** Gateway/Agent contracts, printer status and output uncertainty. **Inconsistencies / fix & next check:** Live desktop interaction/Windows service NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/desktop/icon.svg`
- TODO `src/desktop/index.html`
- TODO `src/desktop/main.tsx`
- TODO `src/desktop/preview.html`
- TODO `src/desktop/theme-light.css`
- TODO `src/desktop/types.ts`
- TODO `src/desktop/ui.tsx`

### `src/desktop/components` — 7 files

**Logic:** Tauri UI components and printer operations. **Shared contract:** Physical outcome labels, RTL and queue readiness. **Inconsistencies / fix & next check:** Tauri WebView Windows runtime NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/desktop/components/AddPrinterDialog.tsx`
- TODO `src/desktop/components/AdminPrivilegeDialog.tsx`
- TODO `src/desktop/components/DesktopLink.tsx`
- TODO `src/desktop/components/JobTimeline.tsx`
- TODO `src/desktop/components/PrinterSharingControl.tsx`
- TODO `src/desktop/components/SetupGuide.tsx`
- TODO `src/desktop/components/Sidebar.tsx`

### `src/desktop/lib` — 4 files

**Logic:** Desktop React view, IPC and Agent connection. **Shared contract:** Gateway/Agent contracts, printer status and output uncertainty. **Inconsistencies / fix & next check:** Live desktop interaction/Windows service NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/desktop/lib/gateway-connectivity.ts`
- TODO `src/desktop/lib/gateway-headers.ts`
- TODO `src/desktop/lib/ipc.ts`
- TODO `src/desktop/lib/printers.ts`

### `src/desktop/pages` — 4 files

**Logic:** Desktop React view, IPC and Agent connection. **Shared contract:** Gateway/Agent contracts, printer status and output uncertainty. **Inconsistencies / fix & next check:** Live desktop interaction/Windows service NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/desktop/pages/Jobs.tsx`
- TODO `src/desktop/pages/Overview.tsx`
- TODO `src/desktop/pages/Printers.tsx`
- TODO `src/desktop/pages/Settings.tsx`

### `src/desktop/preview` — 2 files

**Logic:** Desktop React view, IPC and Agent connection. **Shared contract:** Gateway/Agent contracts, printer status and output uncertainty. **Inconsistencies / fix & next check:** Live desktop interaction/Windows service NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/desktop/preview/main.ts`
- TODO `src/desktop/preview/mock-tauri.ts`

### `src/desktop/public` — 2 files

**Logic:** Desktop React view, IPC and Agent connection. **Shared contract:** Gateway/Agent contracts, printer status and output uncertainty. **Inconsistencies / fix & next check:** Live desktop interaction/Windows service NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/desktop/public/theme-init.css`
- TODO `src/desktop/public/theme-init.js`

### `src/i18n` — 5 files

**Logic:** Arabic/English translations and formatting. **Shared contract:** Quota exhaustion versus expired contract; RTL and currency. **Inconsistencies / fix & next check:** Bilingual UI screenshot/accessibility NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/i18n/config.ts`
- TODO `src/i18n/format.ts`
- TODO `src/i18n/react.tsx`
- TODO `src/i18n/server.ts`
- TODO `src/i18n/translate.ts`

### `src/i18n/messages` — 5 files

**Logic:** Arabic/English translations and formatting. **Shared contract:** Quota exhaustion versus expired contract; RTL and currency. **Inconsistencies / fix & next check:** Bilingual UI screenshot/accessibility NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/i18n/messages/ar.ts`
- TODO `src/i18n/messages/en.ts`
- TODO `src/i18n/messages/v4-admin.ts`
- TODO `src/i18n/messages/v4-experience.ts`
- TODO `src/i18n/messages/v4-onboarding.ts`

### `src/lib` — 118 files

**Logic:** Gateway shared domain policies and SQL operations. **Shared contract:** Billing UTC month, physical outcome, tenant scoping, printer identity, idempotency. **Inconsistencies / fix & next check:** History tenant collision and literal unknown-prefix patches submitted; follow CI.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/lib/action-error.ts`
- TODO `src/lib/activation-contact.ts`
- TODO `src/lib/agent-auth.ts`
- TODO `src/lib/agent-availability.ts`
- TODO `src/lib/agent-control.ts`
- TODO `src/lib/agent-health.ts`
- TODO `src/lib/agent-lifecycle.ts`
- TODO `src/lib/agent-presence-maintenance.ts`
- TODO `src/lib/api-error-keys.ts`
- TODO `src/lib/api-key-deletion.ts`
- TODO `src/lib/application-origin.ts`
- TODO `src/lib/audit.ts`
- TODO `src/lib/auth-rate-limit.ts`
- TODO `src/lib/authorization.ts`
- TODO `src/lib/billing-labels.ts`
- TODO `src/lib/billing-page-snapshot.ts`
- TODO `src/lib/bounded-query.ts`
- TODO `src/lib/cache.ts`
- TODO `src/lib/canonicalize.ts`
- TODO `src/lib/circuit-breaker.ts`
- TODO `src/lib/clipboard.ts`
- TODO `src/lib/common-password-hashes.json`
- TODO `src/lib/console-auth.ts`
- TODO `src/lib/console-read-authority.ts`
- TODO `src/lib/csp-report.ts`
- TODO `src/lib/customer-auth.ts`
- TODO `src/lib/dashboard-billing-usage.ts`
- TODO `src/lib/dashboard-state.ts`
- TODO `src/lib/database-clock.ts`
- TODO `src/lib/database-error-log.ts`
- TODO `src/lib/database-timestamp.ts`
- TODO `src/lib/desired-state-page.ts`
- TODO `src/lib/discovery-observation.ts`
- TODO `src/lib/discovery-session-expiry.ts`
- TODO `src/lib/discovery.ts`
- TODO `src/lib/effective-subscription-status.ts`
- TODO `src/lib/email-auth-token-policy.ts`
- TODO `src/lib/email.ts`
- TODO `src/lib/entitlements.ts`
- TODO `src/lib/exact-printer-id.ts`
- TODO `src/lib/fetch-timeout.ts`
- TODO `src/lib/fleet-cursor.ts`
- TODO `src/lib/idempotency.ts`
- TODO `src/lib/inventory-snapshot.ts`
- TODO `src/lib/invitation-join.ts`
- TODO `src/lib/job-delivery.ts`
- TODO `src/lib/job-diagnostic-payload.ts`
- TODO `src/lib/job-fencing.ts`
- TODO `src/lib/job-history.ts`
- TODO `src/lib/job-maintenance.ts`
- TODO `src/lib/job-status.ts`
- TODO `src/lib/job-timeline-presentation.ts`
- TODO `src/lib/job-timeline.ts`
- TODO `src/lib/lifecycle-labels.ts`
- TODO `src/lib/lifecycle.ts`
- TODO `src/lib/limit-signal.ts`
- TODO `src/lib/log.ts`
- TODO `src/lib/manager-auth.ts`
- TODO `src/lib/manager-mutation-authorization.ts`
- TODO `src/lib/manual-api-error.ts`
- TODO `src/lib/manual-calendar-date.ts`
- TODO `src/lib/manual-plans.ts`
- TODO `src/lib/manual-subscriptions.ts`
- TODO `src/lib/manual-usage-report.ts`
- TODO `src/lib/metrics-machine-auth.ts`
- TODO `src/lib/metrics.ts`
- TODO `src/lib/nanoid.ts`
- TODO `src/lib/nav.ts`
- TODO `src/lib/network-address.ts`
- TODO `src/lib/new-password-policy.ts`
- TODO `src/lib/odoo-auth.ts`
- TODO `src/lib/odoo-idempotency.ts`
- TODO `src/lib/odoo-status-scope.ts`
- TODO `src/lib/odoo-v2-admission.ts`
- TODO `src/lib/password-screening.ts`
- TODO `src/lib/password.ts`
- TODO `src/lib/payload.ts`
- TODO `src/lib/physical-printer-identity.ts`
- TODO `src/lib/plan-price.ts`
- TODO `src/lib/platform-action-confirmation.ts`
- TODO `src/lib/platform-auth.ts`
- TODO `src/lib/platform-data-explorer.ts`
- TODO `src/lib/platform-fleet-deletion.ts`
- TODO `src/lib/platform-session-security.ts`
- TODO `src/lib/platform-stats-cache.ts`
- TODO `src/lib/platform-team-security.ts`
- TODO `src/lib/platform-workspace-lifecycle.ts`
- TODO `src/lib/print-job-service.ts`
- TODO `src/lib/print-output.ts`
- TODO `src/lib/printer-capability.ts`
- TODO `src/lib/printer-geometry.ts`
- TODO `src/lib/printer-health.ts`
- TODO `src/lib/printer-identity.ts`
- TODO `src/lib/printer-model.ts`
- TODO `src/lib/printer-operational-verification.ts`
- TODO `src/lib/printer-verification-sql.ts`
- TODO `src/lib/printer-virtual-sql.ts`
- TODO `src/lib/printer-virtual.ts`
- TODO `src/lib/quota-cycle.ts`
- TODO `src/lib/receipt-width.ts`
- TODO `src/lib/request-limits.ts`
- TODO `src/lib/roles.ts`
- TODO `src/lib/routing.ts`
- TODO `src/lib/runtime-secret.ts`
- TODO `src/lib/server-action-version.ts`
- TODO `src/lib/session-config.ts`
- TODO `src/lib/session-credentials.ts`
- TODO `src/lib/session-events.ts`
- TODO `src/lib/session-inventory.ts`
- TODO `src/lib/session-tokens.ts`
- TODO `src/lib/stale-threshold.ts`
- TODO `src/lib/team-authorization.ts`
- TODO `src/lib/tenant-guard.ts`
- TODO `src/lib/tenant-lifecycle.ts`
- TODO `src/lib/trust-proxy-config.ts`
- TODO `src/lib/utils.ts`
- TODO `src/lib/worker-schema.ts`
- TODO `src/lib/workspace-owner-invitations.ts`
- TODO `src/lib/workspace-session-http.ts`
- TODO `src/lib/workspace-session-security.ts`
- TODO `src/lib/ws-rate-limit.ts`

### `src/server` — 9 files

**Logic:** WebSockets, HTTP boot and realtime delivery. **Shared contract:** Claim and tenant auth, timeout/outcome not printed. **Inconsistencies / fix & next check:** Live network chaos/hardware NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/server/api-defaults.ts`
- TODO `src/server/authorization-monitor.ts`
- TODO `src/server/content-security-policy.ts`
- TODO `src/server/correlation.ts`
- TODO `src/server/cors.ts`
- TODO `src/server/request-guard.ts`
- TODO `src/server/request-path.ts`
- TODO `src/server/trusted-proxy.ts`
- TODO `src/server/ws.ts`

### `src/shared` — 5 files

**Logic:** Cross-client types and UI vocabulary. **Shared contract:** Gateway/desktop consistent unknown markers, locale and job-state names. **Inconsistencies / fix & next check:** Do not imply paper from accepted transport.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `src/shared/diagnostic-test.ts`
- TODO `src/shared/document-label.ts`
- TODO `src/shared/job-retention.ts`
- TODO `src/shared/job-vocabulary.ts`
- TODO `src/shared/printer-presentation.ts`

### `tests` — 557 files

**Logic:** Automated unit, contract, integration and regression suites. **Shared contract:** Real PostgreSQL boundaries and static code contracts. **Inconsistencies / fix & next check:** Green on exact SHA required; tests may be skipped when DB absent.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `tests/admin-privilege-dialog.test.ts`
- TODO `tests/agent-api-bearer.integration.test.ts`
- TODO `tests/agent-body-admission.round5.test.mjs`
- TODO `tests/agent-deletion.test.ts`
- TODO `tests/agent-expiry-evidence.node.test.mjs`
- TODO `tests/agent-health-db.test.ts`
- TODO `tests/agent-health-pagination.contract.test.mjs`
- TODO `tests/agent-health.test.ts`
- TODO `tests/agent-heartbeat-pagination.test.ts`
- TODO `tests/agent-identity-isolation.integration.test.ts`
- TODO `tests/agent-lifecycle.integration.test.ts`
- TODO `tests/agent-presence-sweep-query.test.ts`
- TODO `tests/agent-registration.test.ts`
- TODO `tests/ambiguous-print-outcome.integration.test.ts`
- TODO `tests/api-error-contract.test.ts`
- TODO `tests/app-base-url.test.ts`
- TODO `tests/app-shell-landmarks.test.ts`
- TODO `tests/architectural-constraints-and-statuses.test.ts`
- TODO `tests/architecture-hardening.test.ts`
- TODO `tests/architecture-pg.test.ts`
- TODO `tests/audit-barrel-imports-offline.test.mjs`
- TODO `tests/audit-desktop-gateway-offline.test.mjs`
- TODO `tests/audit-fixes-2026-09.test.ts`
- TODO `tests/audit-gateway-memory-probe.test.mjs`
- TODO `tests/audit-gateway-offline.test.mjs`
- TODO `tests/audit-pos-offline.test.mjs`
- TODO `tests/audit-pos-outcomes.test.ts`
- TODO `tests/audit-printer-lifecycle-offline.test.mjs`
- TODO `tests/audit-repair-regressions.test.ts`
- TODO `tests/auth-401-split.contract.test.ts`
- TODO `tests/auth-login-operational.test.ts`
- TODO `tests/auth-rate-limit-fail-closed.test.ts`
- TODO `tests/auth-rate-limit.test.ts`
- TODO `tests/auth-register-existing-account.test.ts`
- TODO `tests/authentication-cutover.test.ts`
- TODO `tests/authorization-denial-logging.test.ts`
- TODO `tests/batch-status.test.ts`
- TODO `tests/billing-controls.test.ts`
- TODO `tests/billing-entitlement-access.test.ts`
- TODO `tests/billing-live-predicate-contract.test.ts`
- TODO `tests/billing-log-contract.test.ts`
- TODO `tests/billing-page-owner-snapshot.contract.test.ts`
- TODO `tests/billing-page-snapshot-live-owner.integration.test.ts`
- TODO `tests/billing-portal-idempotency.test.ts`
- TODO `tests/billing-renewal-i18n.contract.test.ts`
- TODO `tests/billing-renewal-ui.test.ts`
- TODO `tests/billing-status-shell.contract.test.ts`
- TODO `tests/billing-truth.contract.test.ts`
- TODO `tests/bounded-query.test.ts`
- TODO `tests/browser-wait-cleanup.node.test.mjs`
- TODO `tests/button-link-behavior.test.ts`
- TODO `tests/canonicalize-order.test.ts`
- TODO `tests/capability-page-query.test.ts`
- TODO `tests/capability-pagination-route.test.ts`
- TODO `tests/certification-evidence.test.ts`
- TODO `tests/certification-flight.node.test.mjs`
- TODO `tests/certification-reconciliation.contract.test.mjs`
- TODO `tests/check-public-gateway.node.test.mjs`
- TODO `tests/ci-image-mirror-current-run.node.test.mjs`
- TODO `tests/ci-postgres-fallback.test.mjs`
- TODO `tests/ci-toolchain.contract.test.ts`
- TODO `tests/ci-tripwire.check.ts`
- TODO `tests/circuit-breaker.test.ts`
- TODO `tests/claim-token-redaction.test.ts`
- TODO `tests/client-stale-threshold.contract.test.mjs`
- TODO `tests/clipboard.test.ts`
- TODO `tests/compact-page-headers.contract.test.ts`
- TODO `tests/content-security-policy.test.ts`
- TODO `tests/continuation-credential-idempotency.node.test.mjs`
- TODO `tests/continuation-odoo-activation-revision.node.test.mjs`
- TODO `tests/control-plane-concurrency.integration.test.ts`
- TODO `tests/correlation-ids.test.ts`
- TODO `tests/csp-report-handler.test.ts`
- TODO `tests/csp-reporting-policy.test.ts`
- TODO `tests/csp-style-nonce.test.ts`
- TODO `tests/csrf-origin.test.ts`
- TODO `tests/current-run-pos.node.test.mjs`
- TODO `tests/current-run-report.node.test.mjs`
- TODO `tests/current-run-sale-details.node.test.mjs`
- TODO `tests/customer-platform-separation.contract.test.ts`
- TODO `tests/customer-recovery-ui.test.ts`
- TODO `tests/customer-ux-contract.test.ts`
- TODO `tests/customer-workspace-options.integration.test.ts`
- TODO `tests/customer-workspace-options.test.ts`
- TODO `tests/dashboard-active-job-evidence.test.ts`
- TODO `tests/dashboard-billing-usage.test.ts`
- TODO `tests/dashboard-copy-localization.contract.test.mjs`
- TODO `tests/dashboard-date-i18n.contract.test.ts`
- TODO `tests/dashboard-feedback-ui.test.ts`
- TODO `tests/dashboard-fleet-pagination.contract.test.mjs`
- TODO `tests/dashboard-payload-projection.test.ts`
- TODO `tests/dashboard-printer-authority.test.ts`
- TODO `tests/dashboard-query-bounds.contract.test.mjs`
- TODO `tests/dashboard-reprint-contract.test.ts`
- TODO `tests/database-clock.integration.test.ts`
- TODO `tests/database-clock.test.ts`
- TODO `tests/debugging-robustness.contract.test.ts`
- TODO `tests/deep-review-contract.test.ts`
- TODO `tests/defect-remediation-exhaustive.test.ts`
- TODO `tests/deployment-security-contract.test.ts`
- TODO `tests/desired-state-heartbeat-negotiation.test.ts`
- TODO `tests/desired-state-pagination.test.ts`
- TODO `tests/desktop-admin-recovery.contract.test.ts`
- TODO `tests/desktop-agent-date-direction.contract.test.ts`
- TODO `tests/desktop-auth-contract.test.ts`
- TODO `tests/desktop-bounded-startup.contract.test.ts`
- TODO `tests/desktop-browser-headers.test.mjs`
- TODO `tests/desktop-diagnostic-admission.test.ts`
- TODO `tests/desktop-error-messages.test.ts`
- TODO `tests/desktop-file-output.test.ts`
- TODO `tests/desktop-fleet-count.contract.test.mjs`
- TODO `tests/desktop-fleet-pagination.test.ts`
- TODO `tests/desktop-health-ui.contract.test.ts`
- TODO `tests/desktop-job-response.test.ts`
- TODO `tests/desktop-job-timeline.test.ts`
- TODO `tests/desktop-live-details.test.ts`
- TODO `tests/desktop-preview-startup.test.mjs`
- TODO `tests/desktop-printer-sharing.test.ts`
- TODO `tests/desktop-printer-type.test.ts`
- TODO `tests/desktop-refresh-reliability.contract.test.ts`
- TODO `tests/desktop-subscription-navigation.contract.test.ts`
- TODO `tests/desktop-ui-smoke.test.ts`
- TODO `tests/diagnostic-operation.node.test.mjs`
- TODO `tests/diagnostic-payload-parity.test.ts`
- TODO `tests/dialog-certification-ux.test.ts`
- TODO `tests/dialog-isolation.test.ts`
- TODO `tests/discovery-agent-ownership.contract.test.ts`
- TODO `tests/discovery-approval.test.ts`
- TODO `tests/discovery-commit-f013.test.mjs`
- TODO `tests/discovery-identity.integration.test.ts`
- TODO `tests/discovery-ipp-identity.round5.test.mjs`
- TODO `tests/discovery-provision-target-drift.integration.test.ts`
- TODO `tests/discovery-report-fencing.round5.test.mjs`
- TODO `tests/discovery-security.test.ts`
- TODO `tests/discovery-unit.test.ts`
- TODO `tests/discovery-verify-snapshot-f014.test.mjs`
- TODO `tests/dos-hardening-contract.test.ts`
- TODO `tests/e2e-job-flow.test.ts`
- TODO `tests/email-auth-token-lifetime.integration.test.ts`
- TODO `tests/email-retry-idempotency.round5.test.mjs`
- TODO `tests/entitlement-labels.test.ts`
- TODO `tests/exact-printer-id.test.ts`
- TODO `tests/f017-fetch-body-integration.test.mjs`
- TODO `tests/fleet-api-pagination.contract.test.mjs`
- TODO `tests/fleet-cursor-route.test.ts`
- TODO `tests/fleet-live-authorization.integration.test.ts`
- TODO `tests/font-assets.node.test.mjs`
- TODO `tests/forgot-password-persistence.test.ts`
- TODO `tests/form-accessibility.test.ts`
- TODO `tests/forwarded-ip.test.ts`
- TODO `tests/fresh-printing-admission.test.mjs`
- TODO `tests/gateway-agent-console.contract.test.ts`
- TODO `tests/gateway-auth-ui.node.test.mjs`
- TODO `tests/gateway-connectivity-state.test.ts`
- TODO `tests/gateway-console-metadata.test.ts`
- TODO `tests/gateway-control-lock-order.test.ts`
- TODO `tests/gateway-image-healthcheck.node.test.mjs`
- TODO `tests/gateway-maintenance-and-input.node.test.mjs`
- TODO `tests/gateway-origin-printer-capability.node.test.mjs`
- TODO `tests/gateway-runtime-architecture.test.ts`
- TODO `tests/gateway-server-message.test.ts`
- TODO `tests/gateway-shutdown-after.node.test.mjs`
- TODO `tests/gateway-soak-accounting.node.test.mjs`
- TODO `tests/gateway-soak-payloads.node.test.mjs`
- TODO `tests/gateway-soak-source.node.test.mjs`
- TODO `tests/gateway-ws-authority.test.ts`
- TODO `tests/health-and-installer-safety.contract.test.mjs`
- TODO `tests/health-freshness-contract.test.ts`
- TODO `tests/health.test.ts`
- TODO `tests/heartbeat-billing-degraded.integration.test.ts`
- TODO `tests/heartbeat-cross-agent-identity.test.ts`
- TODO `tests/heartbeat-enabled.test.ts`
- TODO `tests/heartbeat-printer-alias.unit.test.ts`
- TODO `tests/i18n-date-only.test.ts`
- TODO `tests/i18n-own-properties.test.ts`
- TODO `tests/icon-assets-contract.test.ts`
- TODO `tests/idempotency-wire-identity.test.ts`
- TODO `tests/inventory-snapshot-heartbeat.test.ts`
- TODO `tests/inventory-snapshot-version.test.ts`
- TODO `tests/invitation-onboarding.integration.test.ts`
- TODO `tests/invitation-password-login.test.ts`
- TODO `tests/job-cleanup-behavior.integration.test.ts`
- TODO `tests/job-cleanup-contract.test.ts`
- TODO `tests/job-detail-live-authority.integration.test.ts`
- TODO `tests/job-diagnostic-payload-round3.test.mjs`
- TODO `tests/job-diagnostic-payload.test.ts`
- TODO `tests/job-history-tenant-collision.integration.test.ts`
- TODO `tests/job-maintenance.test.ts`
- TODO `tests/job-payload-authorization.test.ts`
- TODO `tests/job-release-guard.integration.test.ts`
- TODO `tests/job-search-normalization.test.ts`
- TODO `tests/job-status-browser.test.ts`
- TODO `tests/job-status-postgres-concurrency.test.ts`
- TODO `tests/job-status.test.ts`
- TODO `tests/job-timeline.test.ts`
- TODO `tests/jobs-pagination-validation.test.ts`
- TODO `tests/kitchen-edit-in-flight-f012.test.mjs`
- TODO `tests/kitchen-lifecycle-runtime.test.mjs`
- TODO `tests/kitchen-ownership-runtime.test.mjs`
- TODO `tests/legacy-print-authorization.test.ts`
- TODO `tests/lifecycle-delivery.test.ts`
- TODO `tests/lint-coverage.node.test.mjs`
- TODO `tests/lint-react-deprecations.node.test.mjs`
- TODO `tests/locale-cookie-security.test.ts`
- TODO `tests/log-credential-redaction.test.mjs`
- TODO `tests/log-level.test.ts`
- TODO `tests/login-workspace-choice.test.ts`
- TODO `tests/logout-fail-safe.test.ts`
- TODO `tests/mailbox-owner-password-setup.test.ts`
- TODO `tests/manager-actor-commit-f013.contract.test.mjs`
- TODO `tests/manager-auth.test.ts`
- TODO `tests/manager-producer-commit-f013.test.mjs`
- TODO `tests/manual-billing-history-migration.integration.test.ts`
- TODO `tests/manual-calendar-date.test.ts`
- TODO `tests/manual-only-billing-migration.integration.test.ts`
- TODO `tests/manual-only-billing-schema.contract.test.ts`
- TODO `tests/manual-plan-pricing.test.ts`
- TODO `tests/manual-subscription-input.test.ts`
- TODO `tests/manual-subscription-state.test.ts`
- TODO `tests/manual-subscriptions.integration.test.ts`
- TODO `tests/metadata-destination.round5.test.mjs`
- TODO `tests/metrics-failure.test.ts`
- TODO `tests/metrics-machine-auth.integration.test.ts`
- TODO `tests/metrics-machine-auth.test.ts`
- TODO `tests/metrics-sanitize.test.ts`
- TODO `tests/metrics-startup.node.test.mjs`
- TODO `tests/migration-hash-audit.test.ts`
- TODO `tests/migration-journal.test.ts`
- TODO `tests/migration-upgrade.integration.test.ts`
- TODO `tests/mobile-appbar.contract.node.test.mjs`
- TODO `tests/multi-instance-gateway.test.ts`
- TODO `tests/multi-tenant-selection.test.ts`
- TODO `tests/native_odoo_scope_regressions.py`
- TODO `tests/nav.test.ts`
- TODO `tests/network-address.test.ts`
- TODO `tests/new-password-unicode-policy.test.ts`
- TODO `tests/o-as1-save-deadline.regression.test.mjs`
- TODO `tests/o9-print-recovery.regression.test.mjs`
- TODO `tests/odoo-accepted-replay-purity.integration.test.ts`
- TODO `tests/odoo-addon-static.test.ts`
- TODO `tests/odoo-auth-database-optional.test.ts`
- TODO `tests/odoo-auto-enrollment.integration.test.ts`
- TODO `tests/odoo-auto-enrollment.test.ts`
- TODO `tests/odoo-billing-boundary.contract.test.ts`
- TODO `tests/odoo-configuration-billing-race.integration.test.ts`
- TODO `tests/odoo-cross-tab-reservation.node.test.mjs`
- TODO `tests/odoo-frontend-automation.node.test.mjs`
- TODO `tests/odoo-gateway-activation-sync.test.ts`
- TODO `tests/odoo-installation-directory-live-authority.integration.test.ts`
- TODO `tests/odoo-kitchen-recovery.node.test.mjs`
- TODO `tests/odoo-replay-admission-contention.integration.test.ts`
- TODO `tests/odoo-runtime-discovery-billing.integration.test.ts`
- TODO `tests/odoo-simulation.test.ts`
- TODO `tests/odoo-status-authority.test.ts`
- TODO `tests/odoo-status-concurrency.integration.test.ts`
- TODO `tests/odoo-status-identity.integration.test.ts`
- TODO `tests/odoo-universal-printing.node.test.mjs`
- TODO `tests/odoo-version-neutral-copy.test.ts`
- TODO `tests/odoo-view-architecture.test.ts`
- TODO `tests/odoo-workspace-contract.test.ts`
- TODO `tests/odoo_geometry_fixture.py`
- TODO `tests/odoo_verification_fixture.py`
- TODO `tests/onboarding-state-hydration.contract.test.mjs`
- TODO `tests/pairing-code-contract.test.ts`
- TODO `tests/pairing-code-fence.integration.test.ts`
- TODO `tests/pairing-origin.contract.test.ts`
- TODO `tests/password-auth-migration.integration.test.ts`
- TODO `tests/password-only-auth.integration.test.ts`
- TODO `tests/password-only-login.routes.node.test.mjs`
- TODO `tests/password-screening-routes.test.ts`
- TODO `tests/password-screening.test.ts`
- TODO `tests/payload.test.ts`
- TODO `tests/perf-cache-query-improvements.test.ts`
- TODO `tests/pg-concurrent-claim.mjs`
- TODO `tests/phase2-routing-fallback.test.ts`
- TODO `tests/physical-history-migration.integration.test.ts`
- TODO `tests/physical-outcome.test.ts`
- TODO `tests/physical-printer-identity.test.ts`
- TODO `tests/plan-entitlements.test.ts`
- TODO `tests/platform-action-confirmation.test.ts`
- TODO `tests/platform-audit-live-authority.test.ts`
- TODO `tests/platform-bootstrap-cutover.test.ts`
- TODO `tests/platform-confidential-read-race.integration.test.ts`
- TODO `tests/platform-control-plane.test.ts`
- TODO `tests/platform-dashboard-integrity.test.ts`
- TODO `tests/platform-database-explorer.test.ts`
- TODO `tests/platform-database-route.test.ts`
- TODO `tests/platform-delete-integrity.integration.test.ts`
- TODO `tests/platform-emergency-actor-fence.test.ts`
- TODO `tests/platform-explorer-pagination.integration.test.ts`
- TODO `tests/platform-fleet-live-authority.test.ts`
- TODO `tests/platform-fleet-status.contract.test.mjs`
- TODO `tests/platform-integrations-control.node.test.mjs`
- TODO `tests/platform-integrations-live-authority.test.ts`
- TODO `tests/platform-live-queue.node.test.mjs`
- TODO `tests/platform-login-cancellation.node.test.mjs`
- TODO `tests/platform-mutation-authorization.test.ts`
- TODO `tests/platform-operations-history.node.test.mjs`
- TODO `tests/platform-operations-pagination.test.ts`
- TODO `tests/platform-operations-ui.test.ts`
- TODO `tests/platform-owner-invitation-session.integration.test.ts`
- TODO `tests/platform-read-live-authority.test.ts`
- TODO `tests/platform-stats-optimization.test.ts`
- TODO `tests/platform-stats.test.ts`
- TODO `tests/platform-tenant-detail-live-authority.test.ts`
- TODO `tests/poll-claim-budget.contract.test.mjs`
- TODO `tests/pos-receipt-font.test.ts`
- TODO `tests/postgres-role-profile.node.test.mjs`
- TODO `tests/print-admission-presentation.node.test.mjs`
- TODO `tests/print-certification.test.ts`
- TODO `tests/print-e2e-regression.test.ts`
- TODO `tests/print-idempotency.test.ts`
- TODO `tests/print-job-database-error-logging.test.ts`
- TODO `tests/print-latency-report.node.test.mjs`
- TODO `tests/print-paths-runtime.regression.test.mjs`
- TODO `tests/print-payload-contract.test.ts`
- TODO `tests/print-quota.test.ts`
- TODO `tests/print-responsive-screens.contract.test.mjs`
- TODO `tests/printer-capability-matrix.test.ts`
- TODO `tests/printer-desired-state.test.ts`
- TODO `tests/printer-destination-security.test.ts`
- TODO `tests/printer-diagnostic-recovery.integration.test.ts`
- TODO `tests/printer-eligibility.test.ts`
- TODO `tests/printer-endpoint-admin.integration.test.ts`
- TODO `tests/printer-geometry-contract.test.ts`
- TODO `tests/printer-geometry-regression.test.ts`
- TODO `tests/printer-geometry-settings.test.ts`
- TODO `tests/printer-geometry.integration.test.ts`
- TODO `tests/printer-language-badges.test.ts`
- TODO `tests/printer-model-alias.test.ts`
- TODO `tests/printer-operational-verification-ui.test.ts`
- TODO `tests/printer-operational-verification.integration.test.ts`
- TODO `tests/printer-operational-verification.test.ts`
- TODO `tests/printer-presentation.test.ts`
- TODO `tests/printer-sharing-validation.test.ts`
- TODO `tests/printer-sharing.integration.test.ts`
- TODO `tests/printer-virtual.test.ts`
- TODO `tests/printing-protocol-end-to-end.contract.test.mjs`
- TODO `tests/production-audit-regressions.test.ts`
- TODO `tests/production-fixes-contract.test.ts`
- TODO `tests/production-hardening-contract.test.ts`
- TODO `tests/production-source-audit.py`
- TODO `tests/production-type-safety.contract.test.ts`
- TODO `tests/queue-payload-budget.test.ts`
- TODO `tests/queue-uncompressed-budget.regression.test.mjs`
- TODO `tests/quota-dialog-render.test.ts`
- TODO `tests/receipt-geometry-v3.test.ts`
- TODO `tests/receipt-width.test.ts`
- TODO `tests/release-readiness-access.test.ts`
- TODO `tests/release-readiness-copy.contract.test.mjs`
- TODO `tests/release-readiness-truth.contract.test.ts`
- TODO `tests/request-guard-http.test.ts`
- TODO `tests/requeue-notify-contract.test.ts`
- TODO `tests/resend-verification-persistence.test.ts`
- TODO `tests/resend-verification.test.ts`
- TODO `tests/reset-password-recovery-ui.test.ts`
- TODO `tests/responsive-layout.contract.node.test.mjs`
- TODO `tests/routing-availability.test.ts`
- TODO `tests/routing-doctype-parity.test.ts`
- TODO `tests/routing-virtual-regression.test.ts`
- TODO `tests/rtl-agreement.test.ts`
- TODO `tests/runtime-agent-picker.contract.test.ts`
- TODO `tests/runtime-constraints.test.ts`
- TODO `tests/runtime-secret-cache.test.ts`
- TODO `tests/s06-identity-policy.node.test.mjs`
- TODO `tests/saas-control-plane-contract.test.ts`
- TODO `tests/saas-copy-progressive-disclosure.test.ts`
- TODO `tests/saas-unified-ux.test.ts`
- TODO `tests/security-credential-response.contract.test.ts`
- TODO `tests/security-scan-offline-workflows.contract.test.ts`
- TODO `tests/server-http-acceptance.test.ts`
- TODO `tests/server-http-boundary.test.ts`
- TODO `tests/service-status-observation.test.ts`
- TODO `tests/session-account-inventory.integration.test.ts`
- TODO `tests/session-account-ui.test.ts`
- TODO `tests/session-admission-client.test.ts`
- TODO `tests/session-body-timeout.round5.test.mjs`
- TODO `tests/session-cookie-security.test.ts`
- TODO `tests/session-inventory.integration.test.ts`
- TODO `tests/session-legacy-fallback.integration.test.ts`
- TODO `tests/session-login-replacement.integration.test.ts`
- TODO `tests/session-logout.integration.test.ts`
- TODO `tests/session-refresh-recovery.test.ts`
- TODO `tests/session-resource-repair.test.mjs`
- TODO `tests/session-tokens.integration.test.ts`
- TODO `tests/settings-live-authority.integration.test.ts`
- TODO `tests/shared-ui-interaction.test.ts`
- TODO `tests/shared-vocabulary.contract.test.ts`
- TODO `tests/signup-api-keys-lifecycle.contract.test.ts`
- TODO `tests/stale-threshold.test.ts`
- TODO `tests/status-evidence-presentation.contract.test.mjs`
- TODO `tests/status-observability.contract.test.mjs`
- TODO `tests/subscription-editor-renewal.test.ts`
- TODO `tests/subscription-owner-directory-live-authority.integration.test.ts`
- TODO `tests/subscription-request-lifecycle.contract.test.ts`
- TODO `tests/subscription-saas-ux.contract.test.ts`
- TODO `tests/sweep-limit.regression.test.mjs`
- TODO `tests/system-contracts.test.ts`
- TODO `tests/tailgrids-ui-current-run.node.test.mjs`
- TODO `tests/team-authority-cutover.test.ts`
- TODO `tests/team-authorization.test.ts`
- TODO `tests/team-directory-live-authority.integration.test.ts`
- TODO `tests/team-invitation-audit-actor.integration.test.ts`
- TODO `tests/team-invitation-authority.test.ts`
- TODO `tests/team-invitation-read-authority.integration.test.ts`
- TODO `tests/team-invitation-restoration.contract.test.ts`
- TODO `tests/team-pagination.contract.test.mjs`
- TODO `tests/team-role-i18n.contract.test.ts`
- TODO `tests/tenant-batch-fencing.integration.test.ts`
- TODO `tests/tenant-batch-fencing.test.ts`
- TODO `tests/tenant-isolation-extended.integration.test.ts`
- TODO `tests/tenant-isolation.test.ts`
- TODO `tests/tenant-lifecycle.integration.test.ts`
- TODO `tests/tenant-lifecycle.unit.test.ts`
- TODO `tests/tenant-scoped-session-revocation.integration.test.ts`
- TODO `tests/tenant-suspension-socket.test.ts`
- TODO `tests/test-print-identity.contract.test.ts`
- TODO `tests/test-suite-classification.contract.test.ts`
- TODO `tests/test_a2_offline_requeue.py`
- TODO `tests/test_a8_a9_a11_odoo_submit.py`
- TODO `tests/test_agent_print_diagnostic_media.py`
- TODO `tests/test_audit_repair_regressions.py`
- TODO `tests/test_ci_audit_fixture.py`
- TODO `tests/test_ci_change_scopes.py`
- TODO `tests/test_ci_proxy_boundary.py`
- TODO `tests/test_codeql_sarif_gate.py`
- TODO `tests/test_complete_audit_permissions.py`
- TODO `tests/test_compose_build_contexts.py`
- TODO `tests/test_compose_release_orchestration.py`
- TODO `tests/test_db_docs_scanner.py`
- TODO `tests/test_desktop_agent_version_round3.py`
- TODO `tests/test_desktop_gateway_draft_contract.py`
- TODO `tests/test_desktop_gateway_io.py`
- TODO `tests/test_desktop_pairing_serialization.py`
- TODO `tests/test_desktop_tray_contract.py`
- TODO `tests/test_docker_context_hygiene.py`
- TODO `tests/test_f010_report_binding_identity.py`
- TODO `tests/test_f016_raw_label_binding.py`
- TODO `tests/test_f018_odoo_outcome_truth.py`
- TODO `tests/test_f019_physical_outcome_proof.py`
- TODO `tests/test_f020_poll_status_fairness.py`
- TODO `tests/test_f021_gateway_pending_clock.py`
- TODO `tests/test_f022_f023_windows_delivery_guards.py`
- TODO `tests/test_f024_desktop_health_projection.py`
- TODO `tests/test_f025_desktop_billing_route.py`
- TODO `tests/test_f026_operational_documentation.py`
- TODO `tests/test_f031_pos_outcome_identity.py`
- TODO `tests/test_f032_style_documentation.py`
- TODO `tests/test_final_security_hardening.py`
- TODO `tests/test_gateway_activation_robustness.py`
- TODO `tests/test_gateway_destination_policy.py`
- TODO `tests/test_go_cleanup_sql_round3.py`
- TODO `tests/test_kitchen_durable_outcomes.py`
- TODO `tests/test_kitchen_idempotency_fallback.py`
- TODO `tests/test_manual_status_sync_isolation.py`
- TODO `tests/test_o1_sale_details_fallback.py`
- TODO `tests/test_o2_binding_revalidation.py`
- TODO `tests/test_o6_intent_retention.py`
- TODO `tests/test_o7_gateway_url_opt_in.py`
- TODO `tests/test_odoo19_printing_static.py`
- TODO `tests/test_odoo_activation_cron_budget.py`
- TODO `tests/test_odoo_activation_rpc_guards.py`
- TODO `tests/test_odoo_agent_assignment_identity.py`
- TODO `tests/test_odoo_async_boundaries.py`
- TODO `tests/test_odoo_binding_dispatch_snapshot.py`
- TODO `tests/test_odoo_company_branch_scope_static.py`
- TODO `tests/test_odoo_config_key_rotation_f015.py`
- TODO `tests/test_odoo_diagnostic_language.py`
- TODO `tests/test_odoo_discovery_response_safety.py`
- TODO `tests/test_odoo_dispatch_exception_phase.py`
- TODO `tests/test_odoo_durable_identity_security.py`
- TODO `tests/test_odoo_exact_operation_key_replay.py`
- TODO `tests/test_odoo_exact_printer_execution_identity.py`
- TODO `tests/test_odoo_fallback_authorization.py`
- TODO `tests/test_odoo_force_reprint_key_bounds.py`
- TODO `tests/test_odoo_gateway_origin_identity.py`
- TODO `tests/test_odoo_gateway_pinned_transport.py`
- TODO `tests/test_odoo_gateway_real_tls.py`
- TODO `tests/test_odoo_gateway_response_bounds.py`
- TODO `tests/test_odoo_global_scope_rules.py`
- TODO `tests/test_odoo_hardened_entrypoint.py`
- TODO `tests/test_odoo_healthcheck.py`
- TODO `tests/test_odoo_intent_company_upgrade.py`
- TODO `tests/test_odoo_migration_cache.py`
- TODO `tests/test_odoo_os_security_profile.py`
- TODO `tests/test_odoo_pairing_identity.py`
- TODO `tests/test_odoo_policy_intent_safety_current_run.py`
- TODO `tests/test_odoo_printer_evidence_exact_identity.py`
- TODO `tests/test_odoo_printer_protocol_alias.py`
- TODO `tests/test_odoo_printer_sharing.py`
- TODO `tests/test_odoo_rate_limit_retry_budget.py`
- TODO `tests/test_odoo_raw_command_admission_round4.py`
- TODO `tests/test_odoo_receipt_geometry_v3.py`
- TODO `tests/test_odoo_receipt_replay_geometry.py`
- TODO `tests/test_odoo_reconciliation_audit.py`
- TODO `tests/test_odoo_report_error_language.py`
- TODO `tests/test_odoo_runtime_capabilities_round3.py`
- TODO `tests/test_odoo_runtime_localization.py`
- TODO `tests/test_odoo_status_cron_budget.py`
- TODO `tests/test_odoo_status_installation_auth.py`
- TODO `tests/test_odoo_submission_cron_isolation.py`
- TODO `tests/test_odoo_test_results.py`
- TODO `tests/test_odoo_transport_error_secrets.py`
- TODO `tests/test_odoo_universal_printing.py`
- TODO `tests/test_partial_gateway_status_reconciliation.py`
- TODO `tests/test_payload_admission_round3.py`
- TODO `tests/test_policy_fanout_key_resilience.py`
- TODO `tests/test_pos_billing_expiry_policy.py`
- TODO `tests/test_pos_receipt_font_rendering.py`
- TODO `tests/test_postgres_dr_contract.py`
- TODO `tests/test_production_audit_regressions.py`
- TODO `tests/test_receipts_repair_parity.py`
- TODO `tests/test_report_outcome_regression.py`
- TODO `tests/test_s06_auto_enrollment.py`
- TODO `tests/test_s06_migration_guards.py`
- TODO `tests/test_s06_odoo_outbox_freeze.py`
- TODO `tests/test_s06_versioned_keys.py`
- TODO `tests/test_secure_image_dependency_locks.py`
- TODO `tests/test_security_contracts.py`
- TODO `tests/test_server_first_run_runtime_commands.py`
- TODO `tests/test_status_sync_savepoint_round3.py`
- TODO `tests/test_tauri_command_acl_contract.py`
- TODO `tests/test_tauri_std_audit.py`
- TODO `tests/test_translation_occurrences_audit.py`
- TODO `tests/test_translation_xml_security.py`
- TODO `tests/test_trivy_baseline.py`
- TODO `tests/test_ui_copy_checker.py`
- TODO `tests/test_ui_overlay_regressions.py`
- TODO `tests/test_v4_odoo_customer_presentation.py`
- TODO `tests/test_v5_original_font_restoration.py`
- TODO `tests/test_v5_runtime_scope_hardening.py`
- TODO `tests/test_windows_change_filter_recovery.py`
- TODO `tests/test_windows_installer_lifecycle_trace.py`
- TODO `tests/test_windows_release_builder_guards.py`
- TODO `tests/test_windows_release_validation.py`
- TODO `tests/theme-consistency.test.ts`
- TODO `tests/token-endpoint-rate-scope.test.ts`
- TODO `tests/tooltip-overlay.test.ts`
- TODO `tests/top-navbar-responsive.contract.test.ts`
- TODO `tests/transport-budget.contract.test.ts`
- TODO `tests/trusted-proxy.test.ts`
- TODO `tests/typography-system.test.ts`
- TODO `tests/ui-axe.test.ts`
- TODO `tests/ui-experience.contract.test.ts`
- TODO `tests/ui-overlay-and-job-evidence.contract.test.ts`
- TODO `tests/v4-arabic-fallback.test.ts`
- TODO `tests/v4-customer-experience.test.ts`
- TODO `tests/v4-desktop-setup.test.ts`
- TODO `tests/v4-home-subscription.test.ts`
- TODO `tests/v4-odoo-errors.test.ts`
- TODO `tests/v4-onboarding.test.ts`
- TODO `tests/v4-pricing.test.ts`
- TODO `tests/verify-email-feedback-ui.test.ts`
- TODO `tests/virtual-writer-version-skew.test.ts`
- TODO `tests/web-request-deadline.test.mjs`
- TODO `tests/windows-desktop-admin-startup.contract.test.ts`
- TODO `tests/windows-installer-process-ownership.contract.test.mjs`
- TODO `tests/windows-native-exit-guards.ps1`
- TODO `tests/windows-release-builder-helpers.ps1`
- TODO `tests/windows-release-evidence-helpers.ps1`
- TODO `tests/windows-service-ownership.contract.test.mjs`
- TODO `tests/windows-service-recovery-native.contract.test.mjs`
- TODO `tests/windows-service-recovery.test.ts`
- TODO `tests/windows-service-registration-ownership.contract.test.mjs`
- TODO `tests/windows-smoke-acl.contract.test.ts`
- TODO `tests/windows-uninstall-ownership-f011.contract.test.mjs`
- TODO `tests/windows-uninstall-resilience.contract.test.mjs`
- TODO `tests/workspace-full-access-policy.test.ts`
- TODO `tests/workspace-invitation-independent.integration.test.ts`
- TODO `tests/workspace-route-isolation.test.ts`
- TODO `tests/workspace-security-fetch.node.test.mjs`
- TODO `tests/workspace-security-ui.node.test.mjs`
- TODO `tests/workspace-session-security.integration.test.ts`
- TODO `tests/ws-ack-tenant-fence.integration.test.ts`
- TODO `tests/ws-claim-delivery.test.ts`
- TODO `tests/ws-envelope-budget.test.ts`
- TODO `tests/ws-listener-setup-race.test.ts`
- TODO `tests/ws-notification-admission.test.ts`
- TODO `tests/ws-notify-fence.test.ts`
- TODO `tests/ws-response-security-headers.test.ts`
- TODO `tests/ws-route-ownership.test.ts`
- TODO `tests/ws-session-fencing.test.ts`
- TODO `tests/ws-shutdown-drain.integration.test.ts`
- TODO `tests/ws-socket-cap.test.ts`

### `tests/__mocks__` — 1 files

**Logic:** Automated unit, contract, integration and regression suites. **Shared contract:** Real PostgreSQL boundaries and static code contracts. **Inconsistencies / fix & next check:** Green on exact SHA required; tests may be skipped when DB absent.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `tests/__mocks__/odoo.ts`

### `tests/fixtures` — 3 files

**Logic:** Automated unit, contract, integration and regression suites. **Shared contract:** Real PostgreSQL boundaries and static code contracts. **Inconsistencies / fix & next check:** Green on exact SHA required; tests may be skipped when DB absent.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `tests/fixtures/odoo19-native-order-change.mjs`
- TODO `tests/fixtures/odoo19-native-update-last-order-change.txt`
- TODO `tests/fixtures/receipt-geometry.html`

### `tests/helpers` — 11 files

**Logic:** Automated unit, contract, integration and regression suites. **Shared contract:** Real PostgreSQL boundaries and static code contracts. **Inconsistencies / fix & next check:** Green on exact SHA required; tests may be skipped when DB absent.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `tests/helpers/authorization-vm.mjs`
- TODO `tests/helpers/odoo-printer-geometry.mjs`
- TODO `tests/helpers/odoo-recovery-indexeddb.mjs`
- TODO `tests/helpers/pg.ts`
- TODO `tests/helpers/platform-session.ts`
- TODO `tests/helpers/printer-geometry.ts`
- TODO `tests/helpers/printer-verification.ts`
- TODO `tests/helpers/printing-contract-vm.mjs`
- TODO `tests/helpers/test-secrets.ts`
- TODO `tests/helpers/workspace-session-vm.mjs`
- TODO `tests/helpers/workspace-session.ts`

### `tests/reporters` — 1 files

**Logic:** Automated unit, contract, integration and regression suites. **Shared contract:** Real PostgreSQL boundaries and static code contracts. **Inconsistencies / fix & next check:** Green on exact SHA required; tests may be skipped when DB absent.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `tests/reporters/skip-summary.ts`

### `typography` — 1 files

**Logic:** UI fonts and assets. **Shared contract:** Arabic and English legibility. **Inconsistencies / fix & next check:** Visual review NOT RUN.

**Review status:** TODO (all file paths indexed; no blanket signoff).

- TODO `typography/tokens.css`

## Acceptance & final re-scan

- Source tree was enumerated with GitHub recursive tree; all paths above included. This is not a line-by-line security audit and no module is falsely marked DONE.
- Re-enumerate the final main SHA after every future batch; check new, deleted, or relocated paths; update this index and `docs/engineering/FILE_COVERAGE_LEDGER.md` without resetting history.
- Until GitHub Actions for exact final SHA completes green and populated staging/Windows spooler/Odoo POS printing is verified, keep remaining work TODO/BLOCKED; mark physical tests NOT RUN.

## 2026-10-28 final source re-scan and additional batches

The recursive GitHub tree at `main@2fa5f7454872d575dfad68a1c1f4668dea204e0e` has **1906 paths**, no tree truncation. Since the initial inventory commit, these two tracked files were new to the inventory; no previously listed tracked path disappeared. Both are indexed here, preserving all earlier evidence.

### `(root)` — newly indexed
- TODO `NOTES.md` — audit ledger itself (index is not a verified test)

### `tests` — newly indexed
- TODO `tests/platform-audit-limit.test.ts` — Platform Owner audit pagination contract; inspect and run on exact SHA

### Reviewed API semantics, stage 2
- **API-LIMIT-003**: `4140abc0402edf42061d5415e4a17cab3510828a` rejects partial/oversized decimal query limits via complete safe-integer parsing. Unit tests cover `10junk`, decimal fractions, exponent notation and overflows. Accepts historical negative/zero clamp behavior (not a data reset).
- **API-ERROR-004**: `0aefc2953d8a3109d59fa1d0cf5de1c56a4c44b1` returns stable `INVALID_STATUS_FILTER` machine code on both tenant/agent and Platform Owner job history. Existing `src/lib/api-error-keys.ts` maps this to translated English/Arabic UI errors; no error body is trusted as the localized UI source. Source and contract tests added.
- **Cross-component code reviewed (selectively, not all paths)**: `agent/internal/printer/outcome.go` uses the same 5 unknown markers; `agent/internal/queue/queue.go` persists terminal local states; `odoo_addons/print_gateway/models/print_job.py` has explicit UNKNOWN states and no automatic resubmission of unknown jobs; `src-tauri/src/commands.rs` has bounded diagnostic idempotency; `src/lib/printer-model.ts` validates private printer destination and transport; `.github/workflows/ci.yml` asserts tenant-scoped foreign keys. These are partial reviews, **not** hardware verification or whole-module DONE.
- **Known CI result:** `17e08a46...` App/Quality typecheck failed due duplicate `isJobFilterStatus` import in another concurrent test change; the later main `tests/job-status.test.ts` has the import only once. Follow exact final run; doc-only CI success may skip application jobs and cannot substitute for full application gates.

### Explicit remaining work
- **TODO**: individual inspection, cross-tenant fault injection and linked test evidence for the other indexed source files and all raw SQL, print route, and platform permission boundaries.
- **BLOCKED / NOT RUN**: installed Windows Agent + spooler/USB/IPPS + Odoo POS, real PDF/receipt output, desktop user session, printer geometry calibration; populated staging database backup/restore and `0102` migration while writers drained.
- **P1 architecture**: no PostgreSQL RLS defense-in-depth; verify tenant predicate coverage before any RLS rollout, and never perform a destructive production migration.
- **Release rule**: no PASS claim for tests not executed on the exact current SHA; cancelled/skipped workflows stay CANCELLED/SKIPPED.


### 2026-10-28 — printer alias privacy / ambiguous execution batch

- **P1 PRINTER-SHARE-ALIAS-002**: local `privatePrinterIds` denied only bare IDs, while the other Agent's claimed ID persisted under its unique cloud alias. The same authenticated tenant+Agent denial now also reaches its deterministic alias. Cloud histories/rows are not deleted; different Agent rows remain untouched.
- **P1 PRINTER-ALIAS-EXACT-003**: a literal local printer ID colliding with a different backend's authenticated cloud alias previously won native exact lookup, risking wrong-printer dispatch. The Agent now refuses this ambiguity before hardware.
- **Regressions**: `tests/heartbeat-cross-agent-identity.test.ts` covers 2 Agents, original and alias, negative sharing/presence and no implicit re-share; `agent/internal/agent/printer_alias_contract_test.go` exercises ambiguous resolution and zero transport calls. Test source was drafted first; direct RED test run unavailable with GitHub-only access (no branch created). Complete Go/Postgres CI **NOT RUN** until an exact-commit Actions job completes.
- **Ruling:** never auto-remap or select any printer based only on a suffix; negative local policy follows a known alias, while an ambiguous positive physical execution fails closed. No CI workflow disabled, no deployment or migration.

**Concurrent merge note:** The native ambiguity fix and its Go regression were committed separately to `main` as `81ef03dacf7235c310697c693025a8c39d66e8e8`; this batch changes only Gateway alias-sharing denial, the PostgreSQL regression and the records. Go native tests still require exact-SHA execution.

### 2026-10-28 — cross-layer spooler, pagination and file evidence review

**Source tree:** non-truncated `main@cdb28b998f6d69db2d24273161fedac6f2ec7f84`, 1915 tracked files. Additional indexed tracked paths are below; existing TODO/BLOCKED entries are retained. No blanket whole-project completion or native/hardware verification is claimed.

**Changes authored through GitHub API** (the source of CI truth is the exact commit):
- `8dbd6ff333f0cfee3f7eff633f572cd004866e7d`: Windows Agent resolves `spooler_name` then `address`; Gateway health projection now uses that same precedence before interpreting explicit spooler status, with stale/no-probe regressions.
- `837e42fd0b6697e9c27c408fa4986a78a12bae83`: team members/invitations, admin tenant/jobs, explorer pagination now parse complete unsigned decimal offsets under their existing bounds. `6cf4c40950c1c9a6b18b66a61459680ca68d53ab` adds explicit 400 `INVALID_OFFSET` before explorer schema coercion. Regression files include `tests/platform-explorer-offset.test.ts`, `tests/jobs-pagination-validation.test.ts` and `tests/team-pagination.contract.test.mjs`.
- `b11078ca0c0b7301aa3e6831ed8a067b138b34d6`, `2a88f18ec24b0123128312f078ae8711a2e55bd2`: Gateway/Odoo PDF output stays pending throughout claimed/printing, never file_created without explicit validated artifact evidence. `638695fa8c8746d7cb06682387e3f43675316f05`, `029d2beaa15cb5d80a092c0758347703871de88a` add independent TypeScript/Python regression tests; physical paper output remains `unknown`.

**Verification:** GitHub-only authoring means RED/green cannot be directly executed before code commits. Any workflow/job marked cancelled, skipped, pending or in progress is NOT RUN/PENDING for success claims; a docs-only green workflow with App jobs skipped does not prove application behavior. There has been no production deployment, hardware printer exercise, Windows desktop session, full Odoo server run, or populated UTC-month migration rehearsal.

**New tracked paths (all TODO until individual verification):**
- TODO `tests/ci-main-preserve-running-gates.test.mjs`
- TODO `tests/odoo-cutover-locking.integration.test.ts`
- TODO `tests/odoo-health-fencing.integration.test.ts`
- TODO `tests/odoo-manual-enrollment.integration.test.ts`
- TODO `tests/platform-explorer-offset.test.ts`
- TODO `tests/platform-manual-collections-policy.test.ts`
- TODO `tests/print-output-status.test.ts`
- TODO `tests/team-platform-list-contract.test.ts`
- TODO `tests/test_odoo_file_output_pending.py`

**Open risk:** full per-file trust-boundary coverage (1900+ files) remains TODO; PostgreSQL RLS absent; actual Windows printer identity, geometry, spooler proof, tenant and company scope, irreversible migration rollback and Odoo POS behavior cannot be certified from remote source-only inspections.

## 2026-10-28 — AUTH-CACHE / CI-PRESERVE-2026-10 (new source batches)

- **Auth / Gateway (PARTIAL):** `src/app/api/auth/manager/me/route.ts` and `src/app/api/platform/auth/me/route.ts` returned user/role/session metadata without an explicit no-store header, unlike the customer probe. `4cc2eff63b2435dcd751ec4e0e07b3c9398c630b` and `cdd9666a126bb7c48158f16f05c16db92438a7cc` apply `private, no-store` to 200 and 401. `942ef291b6cf23f1f6e85ab3c870052cea3fa4d6` adds real password-session integration test. Test's original CI `40600071474` was **CANCELLED**, not PASS. No production auth policy weakened.
- **CI / Full-release gates (PARTIAL):** GitHub workflow job `cancel-in-progress: true` on `main` was repeatedly cancelling running App / Quality, App / Gateway, Go and Odoo verification as new commits landed. `e10eb91b4bcbc1d51e05de73bfa562057da05ca4` changes only their PR-run cancellation policy, retaining running main/merge-group jobs; `b26cc26b35f82c610ca246215589980a4508cf5b` adds a native Node regression. Independent `3bfae88daaaf6bab6576cb88ad4099ba6acbc8e1` ensures a docs-only main push runs these three application scopes rather than reporting skipped jobs as a clean release. These changes do not modify auth/scanner/test strictness. Pending exact-head green CI before DONE.
- **CI root causes confirmed from GitHub logs:** `19311f83` CI run `40600288610` failed App / Quality Typecheck because `tests/printer-capability-matrix.test.ts:166` spread an optional Agent fixture; `772963f29` tightens the fixture to `NonNullable`. That same run and `e10eb91` CI `40600521438` failed Agent / Go formatting in `agent/cmd/cli/gateway.go`; follow-up Go formatting commits `15ffa78e` and `cdb28b99` are present in subsequent main history. Re-run exact current head before calling either green. **No local tests executed** in this GitHub-only session.
- **Remaining TODO/BLOCKED:** Other indexed modules not fully verified; real Windows spooler/USB/IPP/physical paper, Odoo POS, populated PostgreSQL migration+restore, and visual Arabic/RTL acceptance all **NOT RUN**. No deployment or data reset. Preserve previous 1906-file inventory as a dated snapshot; obtain a new untruncated tree before any complete re-scan claims.

### 2026-10-28 — Authenticated list pagination / privacy verification

**DIR-STRICT-001 (API, Workspace + Platform):** Three list handlers accepted JavaScript numeric aliases (e.g. blank, `1e2`, `0x10`) despite the canonical fleet/job strict-offset contract. Earlier regression commit `88c419435c20117947362e4734728586519052f6` added direct GET boundary tests in `tests/team-platform-list-contract.test.ts`. Subsequent code commits reused `parseStrictListOffset`; `2ce80d796fd73574f3e92edbe77fef6d3feb3b48` closes missing `INVALID_OFFSET` and private/no-store headers for workspace member and Platform tenant lists. Invitation list already had a private/no-store response. Owner/session checks and tenant predicates remain intact.

**DIR-STRICT-002 (Platform subscriptions):** `a5025ff650a15173e776a13e87bfec48f11c6a68` rejects nondecimal Platform subscription request offsets *before* querying, and adds `private, no-store` to the authenticated Platform plan catalog and request feed. Regression: `tests/platform-manual-collections-policy.test.ts`.

**DIR-STRICT-003 (Platform operations):** `733df5913035c643fbb9071f0c2c6055a4068d7d` replaces `Number()` coercions on jobs/integrations pagination; preserves 1..100 page limits and 0..10000 offsets, denies malformed/oversized values with stable `INVALID_PAGINATION`, and supplies `tests/platform-operations-pagination.test.ts`. Neither data nor service behavior for valid pagination is intentionally changed.

**Verification / coverage:** These files have been source-read, with focused HTTP regressions authored. CI results MUST be checked on exact SHA after pushes; previous runs cancelled by concurrent main pushes are not PASS. Hardware printing, Windows driver spooler, native Desktop, full Odoo/POS, populated 0102 cutover and root SQL/tenant audit remain BLOCKED/TODO. No user data reset, no deletion, no deployment, no weakening of tests or authentication.

## 2026-10-28 — ODOO-AUTH-INVENTORY-007 / CI-MAIN-008 (continuation)

- **Odoo runtime inventory (PARTIAL, source fixed):** On `main`, the authenticated Agent/printer inventory routes previously opted out of the early Odoo-enabled flag check to preserve configuration access, but the later transactional read key recheck omitted `odoo_enabled`. A disabled integration could enumerate its tenant's devices after HTTP authentication. Commit `b2d135f0d1317e50576e7a98aa029efbcacf8c11` requires the live enabled flag under the credential row lock; existing rotation read-only grace remains. `tests/odoo-runtime-discovery-billing.integration.test.ts` adds both direct disabled-key and concurrent post-auth disablement regressions for Agent/printer inventory. Exact-commit Actions was superseded/cancelled: **NOT VERIFIED PASS**.
- **Main CI release signal (PARTIAL, source fixed):** Commit `3bfae88daaaf6bab6576cb88ad4099ba6acbc8e1` makes real `main` pushes exercise the Gateway/PostgreSQL, Agent/Go and Odoo suites even when a push only changes docs. A real Git-based classifier regression verifies this; unrelated PR/schedule scans remain scoped. Subsequent docs-only head `c82da5e1` did schedule all four app jobs and exposed `gofmt` failure in Agent CLI. Follow-up commit `cdb28b998f6d69db2d24273161fedac6f2ec7f84` corrected this; a later Agent formatting step passed but end-to-end CI conclusions are still required on a final exact SHA. CI green with app jobs skipped is not runtime acceptance.
- **Remaining TODO/BLOCKED:** check exact-head unit, PostgreSQL integration, Go race/vet, Odoo native addon, Windows installer and security job conclusions. No real printer, deployed Windows service, Odoo POS, populated migration/backup-restore or real paper output has been tested. No production deployment/data reset. Existing per-path statuses remain TODO or BLOCKED unless independently proven.

### 2026-10-28 — PDF syntax admission parity (Go and Gateway)

- **P1 PDF-ADMISSION-EOF-001:** Gateway `src/lib/payload.ts` rejects a declared PDF without a literal `%%EOF` marker in the last 4096 bytes, while Go `agent/internal/payload/payload.go` only checked the initial `%PDF-` bytes. Align native parser before dispatch; never try an alternate printer or infer physical output. Keep Windows PDF validation downstream.
- **Regression authored first:** `agent/internal/payload/payload_test.go::TestPDFPayloadRequiresEOFInFinal4096Bytes` rejects missing and out-of-window EOF, accepts a bounded valid trailer; existing valid PDF test now uses complete test bytes. Contract `contracts/print-payload-contract.json` records exact marker/window.
- **Test evidence:** Source-level failing behavior confirmed, but a RED command cannot be run against an unpushed GitHub tree in GitHub-API-only mode; native unit/Go race/Windows tests **NOT RUN** until corresponding Actions job completes. Never upgrade index-only TODO to DONE.

### 2026-10-28 — capability geometry output sanitization

- **P1 GEOMETRY-CAPABILITY-LEAK-004**: `buildPrinterCapabilityMatrix` used the desired-revision-checked `capabilitiesWithCurrentGeometry` for document-type admission but returned the *unsanitized* Agent capability bag to API clients. A revoked/removed `validated_profile` or not-yet-applied geometry could remain visible in the Gateway/Desktop API even as routing stopped trusting it. The same sanitized bag now drives both capability admission and the returned matrix; driver/spooler evidence and nongeometry fields remain intact. Commit `d9c0b31d7d432f7cc06d4ac391b77164cce1dbec`.
- **Regression:** `tests/printer-capability-matrix.test.ts` protects three states: desired/applied revisions behind => geometry hidden; all revisions converged with matching profile => visible; operator removed the profile => hidden. Commit `75f3f5a3543134a2828d4033040b5b8771313625`. Current exact-commit CI verification PENDING/NOT RUN until jobs finish, hardware and GUI still BLOCKED; no data migration or deployment.


### 2026-10-28 — opaque desired-state ACK IDs (Gateway Agent API)

- **P1 PRINTER-ACK-ID-004:** `POST /api/agent/heartbeat` previously called `.trim()` on `desiredStateAcks[].printerId`. Printer IDs are opaque execution identifiers: an invalid padded acknowledgement could claim a **different** exact manager-controlled printer's applied/observed desired revision, weakening change/readiness fences. Source fixed in `ee5f3ab6931adf21d8648b3f67ce022d008808a5` using the existing `isExactPrinterId` validation, preserving transaction and tenant/Agent/manager ownership predicates.
- **Regression:** `6ff69bf4fbc990e69c2b26d47e295755af001094` extends live PostgreSQL `tests/heartbeat-enabled.test.ts`; a valid exact revision-8 ACK is retained when padded/NUL IDs try to acknowledge revision 9. The source and test were committed sequentially through atomic GitHub contents updates to avoid unrelated concurrent changes; no local test runner was used.
- **CI:** Current-commit full Gateway/PostgreSQL, Go race/vet, Odoo tests are **NOT RUN/UNVERIFIED** until GitHub Actions jobs complete for a single SHA. No claim of physical printing, migration rehearsal or full repository signoff; all uninspected paths stay TODO.

## 2026-10-28 — Device-capacity UX, main per-SHA CI and desktop pagination

- **Device capacity / i18n (PARTIAL):** `af1fa98579e5ce3fe950cb5aab40b1749fdeb79d` maps `MAX_AGENTS_EXCEEDED` / `MAX_PRINTERS_EXCEEDED` to existing Arabic/English technical-capacity labels rather than a false HTTP 429 login-attempts warning. `38001e2ff7a7bc53772f4a8366f2a150d6c6b1dc` adds real code-key/locale regression.
- **Technical vs commercial UI (PARTIAL):** `7c6468f985d5e6b4088a0a12c44ee53597b48a18` prevents `UpgradeLimitDialog` from combining a nonbillable device-safety warning with a paid-plan upsell subtitle; `66156b9ca06f99964c5ab6476acebab417c0b106` asserts this on the rendered modal for both Agent/printer resources.
- **CI pending replacement (PARTIAL):** `e2acd25095b87d0d5303d7d5f7696123642216cd` isolates primary Gateway, Quality, Agent and Odoo main branch concurrency by commit SHA (PRs retain per-ref deduplication); `03dc8e23d9f745de0750f4097435234fc2e30d07` protects the workflow rule. Before this, younger pending runs replaced earlier pending jobs despite `cancel-in-progress: false`. Run `40601963921` did execute main's real jobs but failed TypeScript in Desktop IPC, so it is not a passing release gate.
- **Desktop integration (PARTIAL):** `865ae0d59ace250d4b9d5eab1f74b459e3bf378b` fixes TS18048 by validating a present Gateway pagination header map before accessing continuation fields, without breaking old unpaged Gateways. `80f231fe3d3d43bcb27ad9b2bab886e537d96b01` tests the real client read loop for headerless legacy and malformed/incomplete modern cursor responses. The corrected exact SHA's CI was not yet complete when inspected: **PENDING/NOT RUN**, never PASS.
- **Remaining:** full exact-head CI, Odoo live environment, Go race/vet, hardware spooler/IPP/USB, user-facing Arabic RTL visual QA, tenant/company isolation acceptance, and populated PostgreSQL forward-only migration/backup/restore are TODO/BLOCKED. No production deployment, data reset, disabled tests or forced history rewrites.

### 2026-10-28 — invitation directory read authority (live transaction fence)

- **AUTH-INV-READ-003 (P1):** `GET /api/team/invitations` used `requireWorkspaceOwnerForInvites` but did not acquire the tenant lifecycle row lock before reading pending invitee email addresses. A workspace suspension could commit after the HTTP preflight but before the directory read. The owner/session check stays intact and is now preceded by the canonical `requireActiveTenantInTransaction` lock, in the same transaction as both invitation projections.
- **API mapping:** `manualApiError` now preserves explicit tenant suspension/deletion denials as HTTP 403 with stable `TENANT_SUSPENDED`/`TENANT_DELETED` codes and `private, no-store` instead of misreporting these denials as a generic 503. Expired/revoked sessions retain the existing 401 `SESSION_EXPIRED` through the manager authorization policy.
- **Regression:** `tests/team-invitation-read-authority.integration.test.ts` issues a real password-authenticated owner test session, races tenant suspension and refresh-family revocation against an actual PostgreSQL row lock, and verifies response/status after the conflicting write commits; also checks the uncacheable normal list. **GitHub commit:** `529038048ce6107a378e299db5e985006ad69584`.
- **Evidence:** Auth gap verified by direct source inspection; regression added, exact-commit CI started but was QUEUED at initial check. No local PostgreSQL runner was used, RED/GREEN and hardware are **NOT RUN** until Actions actually executes. Related membership endpoint was independently fenced by `9de6c7c2ddc6`. This is a focused P1 fix; remaining paths in the full coverage inventory retain TODO/BLOCKED until independently tested.

## 2026-10-28 — Go race-suite false failure: EOF trailer diagnostic

- **Go/PDF payload (source DONE, CI PENDING):** Earlier actual main CI run `40601963921` failed `go test -race -vet=all ./...`. In `agent/internal/payload/payload_test.go`, malformed input was correctly rejected by production with error `PDF payload is incomplete (missing %EOF trailer)`. The test itself mistakenly demanded two literal percent characters (`%%EOF`) and reported that valid rejection as "admitted." Commit `69ebb306f7782825de5b805b6b5a330c0f1d93d9` adjusts the test to assert the `EOF trailer` refusal without touching production admission rules. Other Agent failures in this older run include `TestAgentSharingPrivateInventoryIncludesRuntimeDesiredAndScopedAliases` and `TestAgentSharingRejectsClaimBeforePrintingAndAllowsStoredResultReplay`; other main commits are modifying those fixture/authentication boundaries. Do not mark native Agent tests PASS without an exact-commit completed run.
- **Verification:** No Go executable was run locally; GitHub Actions is the test authority. The source fixes alone do not certify physical printer output, migration rollback, or cross-tenant behavior. Keep those modules TODO/BLOCKED until hardware and database acceptance.

## 2026-10-28 — DISCOVERY-REPLAY-ID-2026-10-28 / I18N-ERROR-ACTION (this engineering batch)

**Live tree:** `main@a858349205fb93451ab0f1720d9c222549a90568`, 1925 tracked blob paths, recursive tree `truncated=false`. Paths are indexed, NOT fully audited. Status remains TODO for the unverified Gateway, Odoo, native and Desktop modules.

- **Gateway printer provisioning (PARTIAL / CI PENDING):** A verified `discovered_devices` candidate with `candidate_status=provisioned` returned `already:true` solely from `provisioned_printer_id`, even after a manager changed the printer's actual network/IPP resource/spooler destination. The previous retirement/unshare fence did not detect a changed active endpoint. Regression `334298ccc23c487790fd24fff68bda1b2c2afa99`: `tests/discovery-provision-target-drift.integration.test.ts` covers aligned successful replays versus subsequent network IP, IPP resource path and Windows queue drift. Fix `6befad9c38a5e554de91e0125006cb5a9eaab200`: re-check candidate protocol, valid exact current endpoint via the existing canonical `physicalPrinterIdentityKey`, scope, activation and sharing before replay acknowledgment; reject drift with `INVALID_PRINTER_ENDPOINT`. Old print jobs and evidence stay unchanged; no silent printer fallback. GitHub CI runs `40602378375` (test-only) and `40602464924` (production) had not completed when checked: **RED/GREEN NOT RUN / NOT VERIFIED**.
- **Bilingual API guidance (PARTIAL / CI PENDING):** `INVALID_PRINTER_ENDPOINT` was wrongly mapped to the same `errors.printerEndpointMissing` action that told operators to delete and re-add a printer, despite often meaning a withdrawn or edited binding. Test `eb676086c7360b91e98cad9a0d2cdd2a3adb7c77`; map `adfbaddf7ca6ba532b63466eb618f31d713dd89d`; English `382c1441a730015b612a8d589e6849a99ed6c4e4`; Arabic `344fc5d9e11fed4a7a8df4dbf1274c4c46157e96` now tell the operator to review and verify. Separate tests/copy commits `170b08159957be9c23da44dcdb044b7bd809a45c`, `8c1276566ded7f340fe9aca41d8f27b23675588f`, `09e11a174a00f5a7f43df9fffefc06d510ade151` correct `DEVICE_NOT_APPROVED` (workspace approval, not Agent UI) and `UNSUPPORTED_DISCOVERY_TRANSPORT` (printer protocol/transport mismatch, not necessarily outdated Agent). Keep separate missing-endpoint guidance. Exact-head i18n/typecheck/HTTP test verification **PENDING**.
- **Existing unrelated CI failures read, not misattributed:** Docker runs `40602163086`/`40601945652` failed TypeScript `src/desktop/lib/ipc.ts:217-219` possible undefined headers (later source edit `865ae0d59`); Windows `40602077383` failed several native regression cases in Agent sharing, PDF trailer and explicit IPP root (subsequent commits touch those tests/code). Those are historical specific-SHA failures until full green current-head results are seen. No claim of physical printer acceptance.

**Remaining critical gates (BLOCKED):** installed Agent and real Windows USB/IPP queues, Odoo POS and report output, populated 0102 UTC calendar-month migration with backup/restore, security scans tied to release images, and browser Arabic/RTL visual tests. No deployment, data deletion, force-push or history rewrite in this batch.

### 2026-10-28 — bilingual combined pagination error contract

- **API-I18N-PAGINATION-008 (LOW):** Cross-tenant Platform fleet, jobs and integrations endpoints return `INVALID_PAGINATION` for invalid page size or cursor offsets. The Gateway `apiMessageKey` map previously omitted this code, so user-facing Arabic/English components silently received generic request-rejection copy, unlike the correctly specialized `INVALID_LIMIT` and `INVALID_OFFSET` codes.
- **Fix:** Added `errors.invalidPagination` to both EN/AR catalogues, then mapped the exact API code without changing any server validation or auth gate. Commits `bda5b8c266d2b40c1000df21d575e1dd7593662a`, `b42b499658377e387a2076bf5f9a4b0e652581a9`, `8bcb995cfba4b4a2d5d95987632630b84b465b6c`. Added direct locale and API-code regression `tests/api-error-contract.test.ts` in `e86c71e46ca8cfed0dea94fe5608b2e68d3724ec`.
- **Verification:** GitHub CI run `40603287580` was QUEUED at initial inspection, no PASS claimed. Current source and regression present on `main`. No local test runner, no deployment, no billing/migration change. User-facing page-size/cursor copy only; tenant isolation and printer safety untouched.

## 2026-10-28 — ODOO-V2-UNICODE-009: canonical Unicode identity parity

- **Root cause (source-confirmed, Gateway + Odoo):** Python `idempotency_namespace.py::wire_key(version=2)` rejects ill-formed UTF-16 surrogate sequences because they cannot be encoded as UTF-16/UTF-8. Gateway `parseOdooIdentity` previously tested only JavaScript `operation.length` (1..200 UTF-16 units). `JSON.stringify` could hash an isolated surrogate and admit a v2 operation identity the Odoo outbox would never emit. The Platform operator manual legacy reconciliation GET/POST used a separate, weaker `z.string().min(1).max(200)` boundary. Historical v1 bytes must not be changed.
- **Regression source:** `cee40573ad4ca3a727fe9eb29ff0679ba72c66e1` adds Node tests for standalone/embedded invalid high/low surrogates and resolution schema parity, preserving valid astral Unicode. `e374af93e13375ee201ac841ddc3939ad00a2f04` adds independent Python parity cases.
- **Fix source:** `fdee05ef0d78518e5737326051cd002213ffd62a` exports a shared pure `isValidOdooV2OperationId` rejecting isolated surrogates and preserving 200-unit limit; `9496808246b8d3427a763ef02989bf1e5a988b7d` uses that validator in Platform reconciliation requests. No data deletion, protocol fallback, v1 hashing change or deployment.
- **Verification:** Exact-commit CI for `949680824`, run `40603425382`, was queued at latest inspection. Node/Python RED and GREEN execution, PostgreSQL reconciliation integration and physical Odoo POS/Windows printer acceptance **NOT RUN**. Keep all affected directory/module statuses TODO (source partially reviewed) until exact-SHA CI and all relevant tests complete.

### Tree re-scan (untruncated)

At `main@9cc31103851f642543bb51dd22353487b00f5578`, GitHub recursive tree lists **1929** tracked files, `truncated=false`. The existing note remains an inventory, not signoff. Newly observed paths (not present in previous note) are indexed **TODO**:
- TODO `agent/internal/agent/printer_sharing_utf8_contract_test.go` — read/test this source and verify its contracts on exact main SHA
- TODO `tests/billing-status-live-authority.integration.test.ts` — read/test this source and verify its contracts on exact main SHA
- TODO `tests/billing-usage-live-owner.integration.test.ts` — read/test this source and verify its contracts on exact main SHA
- TODO `tests/odoo-configuration-inventory-live-authority.integration.test.ts` — read/test this source and verify its contracts on exact main SHA
- TODO `tests/odoo-keys-inventory-live-authority.integration.test.ts` — read/test this source and verify its contracts on exact main SHA


## 2026-10-28 — combined native spooler/TCP outcome evidence and CI root fixes

**Scope/source:** exact source files on current `main`; prior CI logs are negative evidence against older exact SHAs, not proof that these newer commits pass. Never infer paper was printed from a transport ACK. All listed changed modules remain IN-PROGRESS/TEST-PENDING; other indexed files stay TODO or BLOCKED.

1. **P1 UNKNOWN-PRINT-005 — Windows zero-confirmed WritePrinter:** a successful Win32 `WritePrinter` call with `pcWritten=0` was previously an ordinary failure (`not_printed` projection), despite an attempted physical write. Commit `1238a92801aebc6f901869b2e22604d35a3148f6` adds `TestSpoolerSuccessfulWriteWithZeroReportedBytesIsUnknown` with abort-not-EndDoc assertions. Commit `f7beda510024bd00dbdf61b624515a3981b53d3a` marks the response `UNKNOWN_PARTIAL_DELIVERY` without claiming confirmed bytes; separate pre-StartDoc failures remain distinguishable. Windows race/tests **PENDING**, not PASS.
2. **P1 UNKNOWN-PRINT-006 — TCP first-write uncertainty and invalid counters:** `network.go` converted first `conn.Write` errors with zero confirmed bytes and zero-progress successful writes into ordinary failures; an invalid negative/overreported count could also panic or falsely complete submission. Tests `50447fb9bf3c01c4010f1fd56874b2042847153d` and `8574667c586c3a759d58cff95aa5be136a2fc292`; fixes `e6bbe7e2c311d8a7bc967ecd0f12678460f34394` and `9cc31103851f642543bb51dd22353487b00f5578`. Report physical `UNKNOWN` from any attempted unconfirmed write, while preserving exact confirmed-byte counts and safe pre-dial refusals. Go race/test result **PENDING**.
3. **P1 CLOUD-ALIAS-PRIVACY-007 — heartbeat negative authority:** `privatePrinterIDs` resolved previously published signed cloud IDs against only currently live printer backends, which could omit a private alias after local opt-out/backend removal. Windows and Linux CI RED evidence: run `40602077383` / `40602011033`, `TestAgentSharingPrivateInventoryIncludesRuntimeDesiredAndScopedAliases`. `3e1b0f20da0a52324218ffc9b86cd2bfe531be68` compares owned IDs only with configured exact IDs and exact current Agent-scoped signed aliases, matches durable own aliases and only denies confirmed private/ambiguous IDs (without affecting a foreign Agent's alias), while keeping positive shared aliases untouched. `7eed3b9c906393eddd9448168e57bcc138b8cfad` adds positive/negative and disappeared-backend regression. No added printer auto-sharing.
4. **CI-TEST-ROOT-008 — actual Windows/Go RED diagnostics:** `40601446414`, `40602077383` and `40602375610` showed a false-negative PDF diagnostic (`fmt.Errorf("%%EOF")` displayed `%EOF`) fixed via `96bae99d46e8b2fa0fa1fe689eccc15e3b176d3e` to retain the literal `%%EOF`; a denied-alias test fixture that recomputed the *original* binding through a later revoked runtime selector and panicked, fixed via `34393f5028f108caaa7062b506a57abbccc54001`; and a waiter test using a forged alias that never reached the per-printer mutex, fixed to the real Agent-scoped alias via `afc16ea66fbcea7a06ac9b23d3b46908e7c64712`. These restore the intended test boundary, not production permission.
5. **Concurrent already-corrected source:** Docker/TypeScript CI `40601945652` and `40602163086` had `src/desktop/lib/ipc.ts:217-219` TS18048 optional pagination headers; latest `main` already includes `hasMore !== "true" || !headers`, so no duplicate patch was applied. Old IPP explicit-root test failure in Windows `40602077383` was also already corrected in latest `agent/internal/printer/ipp.go`, retaining root path instead of rewriting to `/ipp/print`. Await exact-commit full verification.

**Verification ledger:** The authoring connector cannot run RED/green locally. GitHub Actions job links/logs above support only historical RED; follow latest actual Windows Go race, Linux Go race, Gateway/Quality, Odoo, Docker and security gate results by exact commit SHA. Real Windows printer, native spooler, USB/IPPS devices, actual paper receipts, Odoo POS and reports, populated-database migration/restore, and production deployment **NOT RUN / BLOCKED**. Avoid reprinting any ambiguous original operation. This register does not certify the entire tree as reviewed.

### 2026-10-28 — account Settings read live-authority fence

- **AUTH-SETTINGS-READ-004 (P1):** `GET /api/settings` performed a one-time workspace authentication check and then fetched tenant and verified user email/Platform Owner identity in independent nontransactional reads. A concurrent tenant suspension, password/session-family revocation, or role change could commit between the preflight and the disclosure. This was a separate exposure boundary from member and invitation directories.
- **Fix:** `src/app/api/settings/route.ts` now holds the canonical active-tenant row and current actor/session guard in a single transaction through both scoped metadata reads. The route returns `private, no-store` for authenticated success/denial, distinct `TENANT_SUSPENDED`/`TENANT_DELETED` and session-expired denials, and generic 503 only for unexpected service errors. The Settings PATCH mutation and its step-up policy are unchanged. Regression `tests/settings-live-authority.integration.test.ts` simulates PostgreSQL tenant suspension and family revocation while owner settings reads are in flight.
- **Commits:** `476b11c886c32d92d71f53041646830c54dc712e` (regression) and `8d2a2af26ec675a405c96021cf33743c86095f7d` (fix). Both were pushed through GitHub contents API after atomic branch-ref updates lost optimistic leases to concurrent main pushes.
- **Verification:** Source and test were checked at latest main; exact-commit GitHub CI run `40603846802` was QUEUED when first inspected, **NOT RUN/PASS**. Hardware, native desktop, Odoo POS, populated 0102 migration rehearsal and complete SQL tenant authorization audit still TODO/BLOCKED. No deployment, data reset or bypass.

## 2026-10-28 — ODOO-V2-UUID-010 and NATIVE-PRINT-LOG-011

- **Odoo installation identity (PARTIAL / CI NOT RUN):** Odoo enrollment requires canonical lowercase UUIDv4. `parseOdooIdentity()` enforced that locally, but the legacy reconciliation GET/POST schema used generic `z.string().uuid()`, accepting UUIDv1/v5/uppercase forms that cannot be the same enrollment identity. `84eebaff17e29ad2fb6e9531a7af5fea1f11a3f8` added a cross-path Node test. `a4ea36e8023ee1a5baf8df41d8697a0e7a82d3ca` introduces/export shared `isCanonicalOdooV2InstallationId()` in `src/lib/odoo-idempotency.ts` and `b95a8203f404c8b24946159eb5ffac90ef5e2196` applies it in `src/app/api/odoo/installations/resolutions/route.ts`. Historical v1 hashes unchanged, no new login/roles, no data rewriting. Test must execute on exact final head before PASS.
- **Windows Agent logs (PARTIAL / CI NOT RUN):** Native USB `WriteFile` and Winspool accepted submission were logged as `Direct USB printed` and `Spooler printed`, incorrectly implying physical paper completion. `7804b79d6511091b2627209b09c1b4d631d1a911` adds Go source-level contract regression across both Windows transports (Linux Go test reads Windows source). `074ff271dfa8550914e6654aae0d6391b0d7d933` changes USB diagnostic to `transport accepted` / `physical output unconfirmed`; `565f00cd615925ec70dbf415077d12b3d7e43a8d` changes spooler equivalent while preserving job ID and byte count. No print state machine or auto-retry logic changed. Actual paper remains unobserved and is NOT VERIFIED.
- **CI evidence:** `main@0c3acebeaa80ba02f872b6b716c3a15cdd7abb4c` GitHub recursive tree `truncated=false`, 1934 tracked files. Relevant CI run `40603662020` (canonical UUID) and `40603906355` (native logging) were QUEUED at review; **do not mark PASS**. Multiple independent teams push to main in parallel; current branch moves while these jobs queue.
- **New file inventory TODO:**
  - TODO `agent/internal/printer/transport_logging_contract_test.go` — unreviewed until code paths and exact-commit verification are attached
  - TODO `tests/agent-health-route-pagination.test.ts` — unreviewed until code paths and exact-commit verification are attached
  - TODO `tests/desktop-gateway-empty-query-fragment.test.ts` — unreviewed until code paths and exact-commit verification are attached
  - TODO `tests/odoo-legacy-resolution-inventory-live-authority.integration.test.ts` — unreviewed until code paths and exact-commit verification are attached

**Remaining BLOCKED:** Windows physical printer/USB/IPPS output, Odoo POS/report with actual paper and locale, populated forward migration and safe backup restore, live tenant fault injection, full SHA-specific Gateway/Go/Odoo CI, browser RTL screenshots. No deployment, reset, data deletion, history rewrite or force-push.


### 2026-10-28 — Agent private-ID parity and diagnostic idempotency audit

**Sources:** live `main` over concurrent writers; never restore an old ZIP or overwrite unrelated HEAD changes. Scopes reviewed: `agent/internal/agent/printer_sharing.go`, `agent/internal/agent/printer_sharing_test.go`, `agent/internal/agent/printer_sharing_utf8_contract_test.go`, `src/lib/exact-printer-id.ts`, `src/app/api/printers/[id]/certify/route.ts`, `src/lib/idempotency.ts`, `tests/certification-evidence.test.ts`, `src/app/api/agents/health/route.ts`, `src/lib/request-limits.ts`.

- **PRINTER-ID-UTF8-005 (P1, changed)**: Go `validGatewaySharingID` formerly enforced 120 **UTF-16 code units**; the Gateway `isExactPrinterId` enforces 120 **UTF-8 bytes**. A private Agent printer name of 31 emoji or 61 accented two-byte letters could poison a whole heartbeat rather than withdraw cloud sharing. Added RED-intent boundary cases `28fe76d4` and matched the native byte guard in `f182ab70`. Current code also fences edge BOM as JavaScript `trim()` does; that compatible test/code was landed by a concurrent contributor. Native validation and real outbound heartbeat remain **NOT RUN** for the latest SHA.
- **PRINTER-ALIAS-ORPHAN-006 (P1, changed)**: An Agent-scoped cloud alias can survive local backend retirement. Existing local denied identity remains the authority; the heartbeat must retain that alias as private, not assume that a missing runtime means the cloud destination is shared. A prior actual Go CI run `40602077445` reproduced a missing aliased private ID. Added retirement regression `ea8dfc59`, refined it `dd004037` to respect the rule that unknown Gateway-owned IDs fail closed. Another concurrent source commit `3e1b0f20` updated the owned-alias resolution to derive from known configs and deny unresolvable/ambiguous cloud IDs. Verified source intent; no green exact-commit suite or real hardware proof.
- **CERT-IDEMPOTENCY-007 (P1, changed)**: Gateway certification `POST /api/printers/[id]/certify` silently trimmed `idempotencyKey` from the JSON body and replaced explicit whitespace-only identities with auto-generated keys. This could alias an intentional replay to a different logical operation. Added live-route mock regression `e83d0f5` with escape correction `e982fca`; source commit `990f817e` reuses canonical `isExactIdempotencyKey`, rejects malformed/empty explicitly provided keys and retains the existing header-first plus short-lived fallback semantics. **NOT RUN** until exact SHA Vitest/production build completes.
- **Health pagination (independently landed):** The `agents/health` endpoint previously used `Number()`, admitting exponent/hex/empty/whitespace representations as valid paging. New tests `tests/agent-health-route-pagination.test.ts` and a concurrent source change now use `parseStrictListOffset` instead. Inspect exact CI before promoting to DONE.
- **CI evidence:** Actual Go run `40602077445` still failed native waiter/alias/PDF/IPP tests on an **older SHA**; Go source/test fixes arrived later, not retroactively passing that run. Historical Quality/Gateway failures included `src/desktop/lib/ipc.ts` TS18048, also patched later. No SHA was declared release-ready. Hardware print, staging, Windows + live Odoo, PostgreSQL backup/restore and exhaustive per-file review remain BLOCKED/TODO.

**Ruling:** Narrow exact-identity validation may reject previously normalized malformed requests, intentionally. Never silently correct a client identity that could select someone else's existing print, credential or physical endpoint. Full release remains blocked until one immutable latest commit passes all enabled workflows and hardware acceptance.

### 2026-10-28 — exact audit actor provenance for workspace invitations

- **AUD-INV-ACTOR-005 (MEDIUM):** Workspace-Owner-only invitation send and revoke were correctly authorized by the workspace session but persisted audit `actor_type='platform'`, falsely attributing a customer action to Platform Owner authority. Global Platform Owner invitation endpoints have been retired (410), so this was provenance/forensic data quality drift, not an authorization grant.
- **Fix:** Keep the owner/session/tenant checks and all data mutations untouched; record `actorType:"user"` for both actions with the existing scoped `claims.userId`. Regression `tests/team-invitation-audit-actor.integration.test.ts` performs a real invite/create/list/revoke flow with PostgreSQL, mocks only the outbound email provider, and asserts both audit records preserve the workspace `tenant_id`, owner `actor_id` and invitation `resource_id`. Commits `b950b17920be2d8348a184407627f0136970172f` (test) and `b7305e24bfd89d7b5c37636e9454b8076872238f` (fix).
- **Verification:** Source/test checked on later main. Exact-fix SHA CI run `40604124072` was QUEUED on inspection; **NOT RUN/PASS** for live PostgreSQL until Actions finishes. Old audit events are deliberately preserved (no destructive rewrite). Audit and source file are reviewed only for this boundary; all other paths remain TODO/BLOCKED.


### 2026-10-28 — signed cloud alias privacy, own Agent versus foreign Agent

**NEW RED:** Windows run `40603163133`, `TestPrivateCloudAliasRemainsWithheldAfterLocalRuntimeBackendIsRemoved` produced a foreign Agent's alias in this Agent's private IDs after the previous fail-closed alias change, even though the foreign alias was not attributable to the local denied device. The test also demands the actual signed alias remain private after both runtime backend and runtime config have been removed.

**Root and fix:** `privatePrinterIDs` originally consulted only the live map, then classified every unmatched owned cloud ID as private. The definitive ownership signal is this Agent's exact signed alias over a *persisted current local binding*. `9e95fb98431cdfea9872de3e51895d2386334614` now matches all durable local sharing bindings (`snapshot.known`) plus runtime/desired config and deduplicates matched local IDs: deny only a confirmed local opt-out, an ambiguous collision, or an untrusted policy; leave unrelated foreign Agent aliases alone. `206e3f2eceb4ab61e9f0236623dc85f56f4eef5b` adds a foreign alias to the durable-backend-removal regression. A separate Windows run `40602729159` showed a queued return token was checked before its outbox was drained; `c31762451ca5eaa9c575907c17951c4a25b0fb88` makes that test exercise the actual authenticated hand-back, without clearing unreconciled claims in production.

**USB unknown-evidence follow-up:** `66839b949de0f3e167d98eb4cdf35e05eb2afba0` + `cf36d550bbe48964471d1009bc7fc3ab8940bd96` fence a successful Win32 WriteFile returning zero bytes; `bcf880117e28600073e84ea840fdc2ec6397b145` + the safely squashed PR #52 `bd0c16ab182f7008355c5b66e6b31888f8854023` prevent over-reported counters from poisoning the USB confirmed-byte ledger even on an error.

**Verification:** These latest changes have NOT completed an exact-SHA native Windows race test, full Gateway CI, or real printer acceptance. Historical RED is attributable to the named older commits, not proof that a newer build passed; no deploy or data reset.

### 2026-10-28 — local desktop diagnostic target exactness

- **DESKTOP-PRINTER-ID-006 (HIGH):** `src-tauri/src/commands.rs::test_printer` previously performed `printer_id.trim()` before invoking the Go CLI with the id as a positional argument. A padded/invalid user-supplied ID could be silently redirected to a different configured queue, violating the fail-closed exact-printer binding rule that other Desktop and Gateway actions use.
- **Fix:** The local test command now validates the opaque requested identity with the same `validate_local_printer_id` guard as local sharing (no silent trimming), rejects option-shaped/overlong/control/BOM-padded IDs, and builds the actual CLI command through `build_local_printer_test_command`. Never infer another target. It retains the bounded CLI timeout and execution-report semantics (submission alone remains unverified paper).
- **Regression:** Rust `src-tauri/src/audit_discovery_test.rs` exercises invalid targets and exact Arabic/English CLI arguments; no process is launched in the test. Commits `0fa19bbbf6fc70fbd581015d67cea17355c4e717` (test), `b4d6aee39cef6b117866adb6716d459e6662fb61` (implementation), `e6291353835923260827365959848405550f5454` (explicit stable `Vec<String>` assertion and formatting).
- **Verification:** Exact-fix Actions had been queued, not green; desktop native Rust build, actual Windows Go CLI, printer hardware and physical test output **NOT RUN**. No session, billing, data, printer assignment or deployment changes. Scope: test-print command boundary only; other Desktop and Agent paths remain TODO/BLOCKED.


### 2026-10-28 — failed Winspool byte-counter inflation regression

**P1 PRINT-SPOOL-COUNT-009:** `executeSpoolerSessionWithSyscalls` rejected `WritePrinter` success with an over-reported per-chunk count, but a *failed* `WritePrinter` with `pcWritten > len(chunk)` still capped that fabricated count at the total payload length and added it to `written`. Although the status remained `UNKNOWN` and AbortPrinter ran, terminal evidence could falsely report that every byte had been accepted. Regression commit `d3461dbbd240438b9cf82a3686a0b7f1d7ba13ea` strengthens `TestSpoolerFailedWriteWithOverReportedCountStillAborts` to require `res.written == 0` when no prior valid progress exists. Fix `8c8cd01dc787849192d1f10a001b9d08597437dc` rejects an over-reported count before any accumulation, returning the existing UNKNOWN physical-outcome classification. Keep the original claim for reconciliation; no automatic rerun, silent fake completion, or data reset. Exact-SHA Windows CI and real hardware **PENDING / NOT RUN**.


### 2026-10-28 — exact Odoo Agent picker IDs, desired-state claim cleanup and Windows fixture lifecycle

- **AGENT-HANDBACK-008 (fixed, test pending):** Source review of `agent/internal/agent/agent.go` showed the desired-state pre-dispatch refusal called `rejectJob` but (unlike printer-not-shared refusal) failed to clear an ACKed exact `queued` SQLite claim. A later outbox scan could repeatedly hand back an already-refunded claim, while a lost ACK must **retain** the token. Added direct real Go Agent/SQLite regression `afe9b74b022392d2835d29eed09ea15df7632bed`; source fix `de9152843685e06745755e1ab3dd4c008af68127` clears only after confirmed Gateway reply, with original token. Never clear on network ambiguity.
- **WIN-TEARDOWN-009 (test harness only):** Prior actual Windows run `40602375610` reported terminal ACK failure after httptest server shutdown and locked TempDir `queue.db`. `agent/internal/agent/agent_test.go` fixture cleanup originally closed the fake Gateway before `Agent.Close()`; test-only commit `83bdf2735d3c103e0f1e7049138e76f30e1b5ac5` reverses teardown ordering to join owned completed work and close SQLite first. Real Windows post-fix run remains NOT RUN. Separately, another writer amended `TestAgentSharingAdmittedJobFinishesWhileMutexWaiterIsReturned` to drain durable hand-back outbox before requiring tokens cleared; do not conflate that fixture ordering with physical success.
- **ODOO-AGENT-IDENTITY-010 (fixed, test pending):** `runtime_printers` RPC previously accepted `agent_id.strip()` and used the normalized ID to inspect scoped printer inventory. The exact remote execution identity must never silently change. Real controller AST regression `7c459bada966d8c39610dea73844e1f90aae9c12` and control escape correction `446c6d6f84514af5397f01015af62372145f7423` cover padding, NUL, BOM, excessive UTF-8 bytes; `32239d8a75558c96f332926f54c65ff876213813` rejects malformed identity before inventory, preserving existing company/branch permission fencing. Additional RED/green-surrogate pair `da427c03ea00b08d9ad512e08f631261cd1ba492`/`52d1e82c93f044182288dacd81ac632e599cd188` prevents a lone JSON surrogate from causing a UTF-8 UnicodeEncodeError and HTTP 500. Positive canonical ID coverage `3e585387a9650de09e4ec366688a4352ff53df11` ensures legitimate requests still enter configured scope/assignment lookup.
- **CI accuracy:** All source/test changes were pushed through atomic GitHub contents updates on live `main`; no local checkout, production changes, migrations, force pushes or disabled tests. The current series of exact-SHA GitHub Actions is queued/backlogged due concurrent `main` commits. An older Windows/Go failure cannot prove latest fixes passed. Go race/vet, Gateway PostgreSQL, Odoo image, Rust/Windows installer, Docker/security and real thermal/IPP/USB hardware acceptance remain **NOT RUN/UNVERIFIED** on the latest immutable head. Keep other indexed files TODO, production release BLOCKED until a single exact SHA is green and hardware acceptance verified.


### 2026-10-28 — exact Odoo status reconciliation identity (v1/v2)

**ODDO-STATUS-IDENTITY-011 (P1, source-confirmed and fixed):** Both Gateway Odoo reconciliation GET routes, `/api/print/jobs` and `/api/print/jobs/v2`, used `searchParams.get("id")?.trim()` and `searchParams.get("idempotencyKey")?.trim()` before querying the accepted job. This allowed padded or explicitly empty replay keys to normalize into another previously accepted operation or to silently ignore a second query selector. POST print routes already use exact-key validation. Source fixes `402f9c4d18d27649a23ad06e32a89743db0743a7` and `2077e6ba3606ece2b3d40ad1ab4521dedbeec022` retain raw URLSearchParams values, require exactly one *present* selector, apply the existing exact printer-ID/idempotency-ID validation and retain the same tenant/installation-scoped transactional status query. Historical receipts/jobs are unchanged; no new physical retry is performed.

**Regression:** `89788c3bf32e5bab9054af4347c110d748c123c9` extends real PostgreSQL `tests/print-idempotency.test.ts` to verify both legacy and v2 GET: malformed/padded/empty IDs, an explicitly empty second selector, valid exact ID/key success and exactly one stored job. Source and test were committed GitHub-only on `main`. Exact-commit CI typecheck/PostgreSQL/Vitest **NOT RUN** until Actions jobs complete; full Odoo POS/receipt reconciliation and Windows hardware remain BLOCKED. These are not grounds for marking the entire source coverage DONE.

### 2026-10-28 — P1 Gateway fleet/job live-read authorization follow-through

**Verified source (not yet CI PASS):** Initial HTTP session/Agent verification had a time-of-check/time-of-use gap before subsequent job detail with explicitly requested raw document bytes, Agent and printer fleet inventory, single Agent/printer detail and job-history queries. Exact tenant-id scoping was not enough if the already-authenticated identity changed. Added canonical tenant FOR SHARE -> current manager/session or Agent hashed-secret/lifecycle guard held through the SQL read. Key commits: aca55289 / 92f8264d (detail regression+fix), 19ecdbe1 / 0404641a / b7442aeb (PostgreSQL fleet/job history race and rotated Agent token tests), 05c482c5 (shared Agent/manager read guard), 80990018 / 0c9f894e (fleet GET fixes), b473fed6 / d5b15b4e (shared job history SQL transaction and GET fence). Single Agent/printer detail routes were concurrently patched and tests extended on main; verify their current exact commit separately. Scope is GET only; permissions, original-payload opt-in, printer/device sharing, retention and subscriptions not relaxed.

**GitHub Actions bottleneck:** 96b52a95 / a5349263 regression source, 6a235fb5 CI workflow grouping, b1a0ddc8 Windows/Docker/security/native workflow grouping prevent unlimited pending main commits while keeping running checks, separate manual/merge-queue gates and original test steps. Superseded pending SHAs show CANCELLED, never PASS; recent exact-main CI still queued/backlogged.

**Status:** PARTIAL code-reviewed / authored tests; PostgreSQL race execution, TypeScript, Go race, Odoo and full security current-SHA results NOT VERIFIED. Prior failures on historical SHAs do not prove this new source failed or passed. Hardware Winspool/USB/IPP, actual print receipts, Odoo POS, production server, data-preserving 0102 migration/restore and RTL visual QA BLOCKED. No production deployment, data reset, test bypass or forced push.

### 2026-10-28 — Odoo exact execution printer and operation identities (follow-up cross-component audit)

- **P1 ODOO-EXACT-EXEC-012 (source-confirmed):** At the Odoo→Gateway print handoff, `PrintGatewayJob.create_operation` accepted `printer_id` after converting and trimming, while `PrintGatewayBinding._check_binding` accepted any nonblank string and the router's fresh-cursor binding recheck compared trimmed names. That could reinterpret a malformed or repointed printer ID as another exact physical destination. Gateway/Agent contract is opaque IDs, max 120 UTF-8 bytes, never silently normalize.
- **Fix:** Shared pure Odoo `runtime_policy.is_exact_gateway_printer_id` rejects nonstrings, padding, BOM at either edge, C0/C1 controls, unpaired Unicode surrogates and IDs >120 UTF-8 bytes (interior BOM/Arabic/multibyte valid IDs remain distinct). Binding creation, outbox admission, persisted `printer_id`, and the router's second-transaction binding check now preserve exact IDs without trimming. Existing durable history was not rewritten. Commits: `dec40fa75c05b1460eefe60e4e3994e9372fbdca`, `68ce952aaab3fa530fd31436b38006a48cb0d22f`, `aa66aeb96c2308308a7ac560068b05b724e8aefc`, `516f67c8b88f8ab3891a10cbc669798f0383929a`, `2c5536ec7d77b5208555af1d3f5a568839feb8bd`.
- **P1 ODOO-OPERATION-KEY-013:** Odoo persisted `(idempotency_key or uuid).strip()`, and POS receipt replay queried `idempotency_key.strip()`. An input like `" receipt-operation-7 "` could silently select the already submitted `"receipt-operation-7"` job, conflating distinct immutable intentions and confusing operator reconciliation. Preserve valid padded v2 keys **byte-for-byte** in local outbox and Gateway wire hash, and query the exact key at replay. No automatic reprint; local `None`, `False`, or empty optional key continues generating a new UUID for backward compatibility. Also compare exact printer ID on replay. Commits: `9f7eb6e13a10498a2de81d6edfba8b51fb9f14b5`, `c42f1726befbef4b7f005e5f98629a4a36e8e258`, `a9539948df06627dbcaa22fad65279a75d5dfb58`.
- **Behavioral regressions:** `tests/test_odoo_exact_printer_execution_identity.py` exercises real source methods with Python AST extraction, invalid/valid Unicode cases and rejects before expensive payload/install work; `tests/test_odoo_exact_operation_key_replay.py` executes the real outbox and receipt replay logic with only ORM/external dependencies substituted; the cursor-handoff test fails if a padded alias passes fresh binding comparison. Existing `tests/test_payload_admission_round3.py` AST fixture was updated to import the actual validator. Tests authored first: `91207216535ca8dac76636a5d2224361af5d300c`, `83172ac3a162944e01e2a9e3dae3504e971696a7`, `f10d9945569fec7ce62942234e8714c06c347dd6`, `e948dfb28b720bc7df5e3b53893c1b7cb1aa2486`, `719ec25f9900f6284e97d084910be2913fef9466`.
- **Verification:** Exact-source and complete test-file presence checked through GitHub contents; no shell/local checkout or running Odoo service is available under GitHub-API-only access. CI runs on intermediate commits were pending/cancelled by subsequent concurrent `main` pushes; Python pytest `tests/test_*.py`, Gateway PostgreSQL, native Windows, actual POS, paper printing, and an exact-head release gate are **NOT RUN/UNVERIFIED**, not PASS. Production deployment, data migration, destructive repair and force push NOT performed. These are focused PARTIAL reviews, not 100% of the repository.


### 2026-10-28 / latest Agent Ledger and Capability live-read batch

**Latest indexed main snapshot:** `main@71229e546a09a3089671fca48401dd3356f105c9` with 1950 tracked blob paths from untruncated recursive Git tree. Indexing is *not* functional verification or release certification. Newly observed unindexed paths:
- TODO `agent/internal/agent/job_identity_mismatch_test.go` — source partially or not yet reviewed; exact-commit CI pending
- TODO `tests/authenticated-home-current-authority.contract.test.ts` — source partially or not yet reviewed; exact-commit CI pending
- TODO `tests/dashboard-current-authority.contract.test.ts` — source partially or not yet reviewed; exact-commit CI pending
- TODO `tests/dashboard-current-authority.integration.test.ts` — source partially or not yet reviewed; exact-commit CI pending

**Agent durable claim/idempotency:** `agent/internal/queue/job_identity_immutability_test.go` + `agent/internal/agent/job_identity_mismatch_test.go` cover duplicate `job_id` and incompatible printer/payload binding. Source changes in `agent/internal/queue/queue.go` and `agent/internal/agent/agent.go` reject different original operation bytes before the first hardware submission; on live mismatch, issue one terminal known-zero-byte failure rather than `ledger_unavailable` requeue loop. Keep original SQLite row and claim data for forensic recovery. Commits `8519db76`, `93dc28b2`, `de727f41`, `91123161`, `ec6e82ba`, `5cbbec45`, `b523ae6d`. Status: source PARTIAL, tests AUTHORED, Go race/Windows CI and real USB/IPP/paper NOT VERIFIED.

**Gateway capability inventory:** Existing test mocked old helper names and no longer covered current transaction-scoped auth after `b9a55e19`; test corrected to assert tenant+actor+same-transaction data select, valid keyset/direct reads, and accurate 403 policy error. An explicit `?printerId=` previously widened single detail read into tenant-scoped collection; now returns private HTTP 400 before query. Commits `d9b4180f`, `d3b74f52`, `eafc4b75`, `60319525`. Status: tests AUTHORED/UNVERIFIED, route PARTIAL, full security/DB/read-race tests still outstanding.

**CI:** Exact fix commits had queued jobs cancelled as parallel `main` changes superseded them; cancellation is **NOT** test PASS, and authored tests do not establish an observed RED→GREEN cycle. Latest full CI, Docker, native installer and static/security workflows `NOT VERIFIED`. Refer to `docs/engineering/SYSTEM_UNIFICATION_NOTEBOOK.md` and `docs/engineering/FILE_COVERAGE_LEDGER.md` for cross-component contracts and explicit verification debt. No production deployment, migration rewrite, reset, hardware-print certification or force push.

### 2026-10-28 — exact printer evidence IDs in Odoo geometry and verification

- **OD-PRINTER-EVIDENCE-014 (MEDIUM):** Both pure Odoo geometry (`printer_geometry.py`) and operational-verification (`printer_verification.py`) parsers validated a reported printer ID using Python character length (plus geometry UTF-16 length), not the Gateway/Agent execution contract of at most 120 **UTF-8 bytes**. Consequently `"é"*61` and `"😀"*31` passed despite being unexecutable 122/124-byte identities. Leading/trailing BOM was also admitted, allowing reported proof for an ID Gateway's JS trim would reject.
- **Root-cause fix:** Both independently loaded pure parsers reject overlong UTF-8, lone-surrogate encoding errors and edge BOM without normalizing IDs, while preserving valid Arabic and multibyte IDs up to 120 bytes and legitimate interior BOM. Existing native timestamp, fingerprint, geometry, transport, operational evidence and agent ownership checks stay unchanged. Regression `tests/test_odoo_printer_evidence_exact_identity.py` invokes both actual parsers with bounded source fixtures. Commits `d3abd62e6f7c032b9239919c0ba9c5dde13069c7` (test), `83cc83856b0e0b2dfb3c15949e9ca4d5314e9d23` (geometry) and `c60fdda1675b631ad1be64058132cf11e42c33f5` (verification).
- **Verification:** Exact-source & regression presence checked via GitHub, but all exact-SHA CI attempts were **CANCELLED** amid concurrent pushes. Python unit, live Odoo, Gateway PostgreSQL, physical receipt/printing and end-to-end geometry measurements **NOT RUN / UNVERIFIED**, never PASS. No data, migration, production deploy, printer state or subscription changes. These are PARTIAL reviewed boundaries.

### 2026-10-28 — exact Gateway job ID after ambiguous Odoo submission

- **P1 ODOO-REMOTE-JOB-ID-015:** `PrintGatewayJob._lookup_gateway_job_for_ambiguous_submission` fetched by the original durable idempotency key but validated only `remote_id.strip()` then stored the trimmed remote job ID. A malformed/padded Gateway response could silently bind the local ambiguous physical attempt to a different exact remote job; future reconciliation would trust that false association. Gateway `GET /api/print/jobs` already requires exact IDs.
- **Fix:** `runtime_policy.is_exact_gateway_job_id` mirrors the Gateway status lookup’s 120 UTF-8-byte exact contract via the existing printer ID predicate. The Odoo lookup now rejects invalid returned IDs with `ValueError`, performs exact equality under its existing locked status row, and persists exact unmodified bytes without remapping an uncertain operation. Existing unknown/no automatic retry and authenticating Odoo key checks remain unchanged. Commits: `8f6c56e76c7248769f3ca3f33855fafc7161c080`, `5e27fc5cbd6842593cbafb8e03ed4ca7ec1459b2`.
- **Regression:** `tests/test_odoo_exact_operation_key_replay.py` runs the actual reconciliation method on padded, BOM, control, multibyte overlong and valid Arabic response IDs (`922fd88ae78aab16d15c3066f81addfc89ac4fd8`). Existing `tests/test_final_security_hardening.py` no longer asserts that an unsafe `.strip()` remains; it now requires exact identity preservation (`4482cadb65c297a67c5780cab684c4e40275f6bf`).
- **Verification:** Source and regression were checked on exact latest GitHub main; workflow run `40608201639` pending on inspection, **NOT RUN/PASS**. No data rewrite, tenant crossover, retry policy change, migration or deployment. Odoo runtime, genuine lost-response POST, real printer, cross-component contract, current CI acceptance remain TODO/BLOCKED.

### 2026-10-28 — Gateway HTTP 200 cannot normalize a remote job ID

- **P1 ODOO-JOB-ID-200-016:** The normal `_action_submit_trusted` 200/201 response path also used `remote_id.strip()`. A malformed padded/BOM/overlong Gateway `jobId` was treated as valid and could create a false association to a different physical print. This separate gap persisted after the ambiguous lookup was corrected.
- **Fix:** Reuse `runtime_policy.is_exact_gateway_job_id` on initial successful HTTP responses. Malformed IDs raise the existing `GATEWAY_INVALID_RESPONSE` branch, which persists the original outbox as `UNKNOWN_SUBMISSION_OUTCOME` without auto-retry or false printed evidence. It does not modify received printer, local operation, tenant, retained queue, or status reconciliation contracts. Regression `odoo_addons/print_gateway/tests/test_control_plane.py::test_26g2_gateway_200_invalid_job_id_keeps_original_outcome_unknown` tests padded, edge-BOM and UTF-8 overlong identities and verifies exactly one remote POST. Test commit `9ca18c9184035a56a108add0dd0f61d66f5e0062`, source fix `42510422e260d03a35a6cf79982d5d076dae4f7f`.
- **Verification:** Actual live Odoo integration test and exact-source-head GitHub CI PENDING / NOT RUN on inspection. No production deployment or physical printer claim.


### 2026-10-28 — Agent/printer trust-boundary parity (source PARTIAL, verification BLOCKED)

- **Agent native printer identities:** `agent/internal/printer/geometry.go`, `agent/internal/printer/verification.go`, `agent/internal/agent/printer_sharing.go`, `agent/internal/printer/gateway_printer_id.go`: common strict 120 UTF-8-byte, valid Unicode, no control/edge-whitespace wire identity. New real native geometry/proof regression in `agent/internal/printer/gateway_printer_id_contract_test.go`. Commit `cf36d8e81322afa439a2f4d677a2f397d3a23ad9` unifies Go native predicate; `8ed0f736...` and `a0c292d...` align Gateway geometry.
- **Operational proof identity authority:** `src/lib/printer-operational-verification.ts`, `odoo_addons/print_gateway/printer_verification.py`, `tests/odoo_verification_fixture.py`, `contracts/printer-operational-verification-{contract,fixtures}.json`: native Go requires method-specific queue/service/device strength. Earlier Gateway and Odoo validators incorrectly accepted a forged device-strength proof for a Windows queue or IPP service. `53975cd7a4eefef8d5ce8d75a16d386399fcea58` adds shared invalid fixtures consumed by native Go, Gateway TypeScript and Odoo Python. Fixed Gateway `4c2a17e9...`, Odoo `c4c5e9e2...`, Odoo fixture `e69aa0fe...`. `68cb7286...` adds normative mapping and `0b7f4e80...` consumes it in Gateway. `f8a33bb7...` adds live PostgreSQL Agent heartbeat regression checking forged verification is *pending*, no binding remains, no forged capability is retained and no owner sharing/lifecycle is changed.
- **State:** all affected modules `PARTIAL / CI PENDING`, not DONE/PASS. Rapid concurrent main commits coalesce queued GitHub Actions, so there is **NO completed green exact-head Windows Go/race, Node/PG, Odoo, Docker or static security result** for this batch. Old native Windows and Linux failures are historical RED evidence on other SHAs. Physical USB/IPP/Windows spooler output and Odoo POS/receipts remain BLOCKED; never repeat ambiguous output without reconciliation. No migration, data deletion, force-push or deployment.
- Detailed contract and commits: `docs/engineering/SYSTEM_UNIFICATION_NOTEBOOK.md`, sections `PRINTER-IDENTITY-UTF8-011` and `PRINTER-PROOF-STRENGTH-012`.

### 2026-10-28 — Odoo module integration, precise identity and no-repeat safety (continued)

**ODDO-FAILOVER-ID-021 (HIGH):** In `runtime_policy.inventory_has_shared_printer`, a legacy/malformed inventory owner was accepted solely because `agent.id.strip()` was nonempty; the primary ID itself was not checked at the failover proof boundary. A malformed or aliased Agent/primary is no authority for automatic backup print, even before first byte. Regression `06cc5b7039aa`; fix `fa4e02bff4b0` uses exact ID validation for primary and owner, keeping the original print job if proof fails.

**ODDO-STATUS-IDENTITY-022 (HIGH):** `PrintGatewayJob._apply_synced_status` admitted status bodies lacking a remote ID or with conflicting `id` and `jobId`; an unrelated HTTP 200 could promote a job to success/late-success. Regression `e42df48284f8`, native fixture alignment `8c493c10edcb`, fix `8cb8b80ccc09`: insist on exact authenticated returned ID equal to persisted job identity and noncontradictory aliases before any status/evidence mutation. Batch-status mapping could overwrite duplicate IDs or trust foreign IDs: regression `9ed57c63f33f`, test harness `b0f87077b321`, fix `8f40f2477c24` falls back to exact per-job lookups rather than accepting ambiguous batch replies. Existing 404/unknown/late-success and no-auto-retry contracts remain unchanged.

**ODDO-AGENT-SCOPE-023 (HIGH):** Stored `runtime_agent_id` and request checks in `runtime_assignment.py` used `.strip()`, allowing malformed assigned records to authorize a different exact Agent. Regression `6a2e4706e470`; fix `88a6343a967e` rejects malformed stored/requested IDs. AST regression helpers updated in `a3e9d0323a00`, `10717e069092`. Discovery and pairing were also inconsistent: regression `bcd2f2a3fdb7`, runtime picker fix `18bd5f3c308c`; pairing regression `b140c43d6585`, wizard fix `41f4a8ea7a50`. Canonical Unicode/Arabic IDs remain valid; company/branch authority boundaries are not relaxed. No migration or rewrite of historical assignments.

**ODDO-POS-RETRY-024 (HIGH):** POS Kitchen originally interpreted `failed` with missing/false `can_retry` as safely retryable, potentially minting new operation IDs after ambiguous outcomes. Regression `296b4e5c2e09`, fix `ae8500775cff` requires explicit `can_retry === true`, otherwise retains UNKNOWN and no new print. POS receipt similarly finalized its recovery fence for every bare `failed`, discarding the exact prior idempotency key. Regression `d5c8c11ae999`, fix `39c16fb2a4de`: only a proven safe failure closes that fence; unproven failure remains UNKNOWN and reuses original bytes, geometry and identity. Neither fix claims physical paper success.

**Verification boundary:** Commits are confirmed pushed through GitHub, but rapidly changing `main` caused exact-commit CI runs to be canceled before application/Odoo/Go/Rust jobs finished. All RED/GREEN claims remain **NOT RUN / NOT VERIFIED** until exact-SHA Actions or installed Odoo/real hardware runs. The historical 0101/0102 quota data, tenant/company separation, browser-independent physical outcomes, and all other unreviewed module paths remain TODO/BLOCKED; **not** fully audited, deployed, or release-certified.

**ODDO-POS-EXACT-TARGET-025 (HIGH, additional Odoo POS boundary):** Both `PosOrderGatewayPrinting.has_gateway_kitchen_binding` and `action_print_gateway_kitchen` previously used `if pos_printer_id:`, so explicitly supplied zero, empty strings or False-like invalid IDs silently routed through the POS default printer. Only Odoo's genuine `None`/`False` unset sentinel may select fallback; an explicitly provided ID must be a positive exact integer and must exist in the selected POS's preparation printers. Offline executable AST regression `tests/test_odoo_pos_printer_target_ids.py` in `b42358e438a1`; implementation `bf3fe5ccce15`. Regression asserts no printer browse or dispatch side effect for malformed values, Arabic-independent Odoo record scoping and positive selected ID preservation. CI RED/GREEN **NOT VERIFIED**; no live POS/native printer/deployment.

**ODDO-POS-RETRY follow-up:** A failed Gateway RPC reply without explicit `can_retry: true` could terminate a receipt recovery fence and allocate a new print intent on the next user interaction. The real POS VM regression `d5c8c11ae999` and fix `39c16fb2a4de` preserve original image, geometry and key across unproven failed replies. Kitchen VM regression `296b4e5c2e09` and fix `ae8500775cff` require positive safe-retry proof before offering new ticket. These prevent accidental extra paper; no assumptions of paper completion.


### 2026-10-28 — PAYLOAD-OPTIONAL-PROTOCOL-017: Gateway/Go exact wire parity

- **P1 contract gap:** Gateway `src/lib/payload.ts` uses `z.enum(rawProtocols).optional()`, so a PDF/JPEG payload may OMIT `protocol` but may not provide `null` or the empty string. Go `agent/internal/payload/payload.go` previously treated present `null` as absent and also admitted explicit `""` on document/image types, allowing a wire shape that Gateway rejects.
- **Test-first commits:** `ca1137c7d598fa0665cf9a5756adbe46f90e32d7` (null case) and `688dd9966a38b3ad6d57d20a120e9a0f90ec97e2` (empty string) in `agent/internal/payload/payload_test.go`; both assert real PDF/JPEG decoding still accepts *missing* `protocol`, while present invalid values fail before physical transport.
- **Source fixes:** `db5aaa2f969caebb220b8f70a3b8c800c843cb9a` treats a present-null optional string as wrong typed; `e6e6c1ef2b3453ce7dab05cde373c3c427bd9861` rejects any present protocol for PDF or JPEG, matching Gateway's no-protocol rule. No entitlement, claim fence, unknown-outcome policy, data migration, tenant routing or physical backend changed.
- **Evidence:** GitHub source and test diffs inspected; no direct execution of an unpushed RED commit was available under the GitHub-only requirement. Workflow runs on these exact commits were **CANCELLED** by concurrent main updates: **NOT PASS**. Go unit/race/vet, full Gateway CI, Odoo, physical Windows/IPP/USB, restore/migrations remain NOT RUN on the final integrated SHA. This is **PARTIAL** until a completed current-HEAD CI run proves it.
- **Ruling:** Missing optional field is allowed; explicitly present null/empty protocol never silently becomes an absent field. Preserve fail-closed semantics, no automatic ambiguous physical retries.
