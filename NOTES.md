# NOTES.md — Yaseir Cloud Printing full-repository engineering coverage

Source: `main@ddc4fc7bed57ee9f0893a09692c62367fd463372`. Re-scanned **1917 tracked files** in **89 directory groups** through GitHub's complete recursive tree (`truncated=false`). This is a coverage index, **not** a claim of line-by-line audit. This file is root-level, outside the Gateway/Agent/Odoo/Desktop product trees.

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
- TODO `agent/internal/printer/discovery_other.go`
- TODO `agent/internal/printer/discovery_progress_test.go`
- TODO `agent/internal/printer/discovery_resilience_test.go`
- TODO `agent/internal/printer/discovery_scan.go`
- TODO `agent/internal/printer/discovery_scan_test.go`
- TODO `agent/internal/printer/discovery_targets.go`
- TODO `agent/internal/printer/discovery_targets_test.go`
- TODO `agent/internal/printer/discovery_test.go`
- TODO `agent/internal/printer/discovery_windows.go`
- TODO `agent/internal/printer/dispatch_admission.go`
- TODO `agent/internal/printer/dispatch_admission_test.go`
- TODO `agent/internal/printer/document.go`
- TODO `agent/internal/printer/document_test.go`
- TODO `agent/internal/printer/document_timeout_test.go`
- TODO `agent/internal/printer/factory.go`
- TODO `agent/internal/printer/factory_usb_identity_test.go`
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
- TODO `src/lib/bounded-query.ts`
- TODO `src/lib/cache.ts`
- TODO `src/lib/canonicalize.ts`
- TODO `src/lib/circuit-breaker.ts`
- TODO `src/lib/clipboard.ts`
- TODO `src/lib/common-password-hashes.json`
- TODO `src/lib/console-auth.ts`
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
- TODO `tests/discovery-report-fencing.round5.test.mjs`
- TODO `tests/discovery-security.test.ts`
- TODO `tests/discovery-unit.test.ts`
- TODO `tests/discovery-verify-snapshot-f014.test.mjs`
- TODO `tests/dos-hardening-contract.test.ts`
- TODO `tests/e2e-job-flow.test.ts`
- TODO `tests/email-auth-token-lifetime.integration.test.ts`
- TODO `tests/email-retry-idempotency.round5.test.mjs`
- TODO `tests/entitlement-labels.test.ts`
- TODO `tests/f017-fetch-body-integration.test.mjs`
- TODO `tests/fleet-api-pagination.contract.test.mjs`
- TODO `tests/fleet-cursor-route.test.ts`
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
- TODO `tests/inventory-snapshot-heartbeat.test.ts`
- TODO `tests/inventory-snapshot-version.test.ts`
- TODO `tests/invitation-onboarding.integration.test.ts`
- TODO `tests/invitation-password-login.test.ts`
- TODO `tests/job-cleanup-behavior.integration.test.ts`
- TODO `tests/job-cleanup-contract.test.ts`
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
- TODO `tests/platform-bootstrap-cutover.test.ts`
- TODO `tests/platform-control-plane.test.ts`
- TODO `tests/platform-dashboard-integrity.test.ts`
- TODO `tests/platform-database-explorer.test.ts`
- TODO `tests/platform-database-route.test.ts`
- TODO `tests/platform-delete-integrity.integration.test.ts`
- TODO `tests/platform-explorer-pagination.integration.test.ts`
- TODO `tests/platform-fleet-status.contract.test.mjs`
- TODO `tests/platform-integrations-control.node.test.mjs`
- TODO `tests/platform-live-queue.node.test.mjs`
- TODO `tests/platform-login-cancellation.node.test.mjs`
- TODO `tests/platform-mutation-authorization.test.ts`
- TODO `tests/platform-operations-history.node.test.mjs`
- TODO `tests/platform-operations-pagination.test.ts`
- TODO `tests/platform-operations-ui.test.ts`
- TODO `tests/platform-owner-invitation-session.integration.test.ts`
- TODO `tests/platform-stats-optimization.test.ts`
- TODO `tests/platform-stats.test.ts`
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
- TODO `tests/shared-ui-interaction.test.ts`
- TODO `tests/shared-vocabulary.contract.test.ts`
- TODO `tests/signup-api-keys-lifecycle.contract.test.ts`
- TODO `tests/stale-threshold.test.ts`
- TODO `tests/status-evidence-presentation.contract.test.mjs`
- TODO `tests/status-observability.contract.test.mjs`
- TODO `tests/subscription-editor-renewal.test.ts`
- TODO `tests/subscription-request-lifecycle.contract.test.ts`
- TODO `tests/subscription-saas-ux.contract.test.ts`
- TODO `tests/sweep-limit.regression.test.mjs`
- TODO `tests/system-contracts.test.ts`
- TODO `tests/tailgrids-ui-current-run.node.test.mjs`
- TODO `tests/team-authority-cutover.test.ts`
- TODO `tests/team-authorization.test.ts`
- TODO `tests/team-invitation-authority.test.ts`
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
- TODO `tests/test_odoo_async_boundaries.py`
- TODO `tests/test_odoo_company_branch_scope_static.py`
- TODO `tests/test_odoo_config_key_rotation_f015.py`
- TODO `tests/test_odoo_diagnostic_language.py`
- TODO `tests/test_odoo_discovery_response_safety.py`
- TODO `tests/test_odoo_dispatch_exception_phase.py`
- TODO `tests/test_odoo_durable_identity_security.py`
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
