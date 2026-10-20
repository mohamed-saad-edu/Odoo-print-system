# Engineering Audit Ledger — Yaseir Cloud Printing Platform

> **Scope**: the 66-item engineering audit of the Odoo → Gateway → Agent → Printer
> pipeline, re-verified against the repository at the commit recorded below.
> **Rule**: a finding is only "FIXED" when a behavioural correction exists and a
> regression test demonstrates it. Comments, documentation and log changes are
> never counted as fixes.
>
> Dispositions: `CONFIRMED — FIXED` · `CONFIRMED — FIX REQUIRED` ·
> `PARTIALLY MITIGATED` · `VERIFIED EXISTING PROTECTION` · `INTENDED BEHAVIOR` ·
> `FALSE POSITIVE` · `BLOCKED — ENVIRONMENT` · `BLOCKED — PRODUCT DECISION`

## Verification environment

| Item | Value |
|---|---|
| Audit base commit | `5d015b2` (main) |
| Local Node | v24.21.0 (must be used; the default `node` on this host is v22 and lacks `crypto.argon2`) |
| Local PostgreSQL | 17.9 (conda). CI uses the pinned **PostgreSQL 16.15** image — that is the authoritative run. |
| Local Go | 1.26.9 |
| Windows / Odoo 19 runtime | not available locally; verified in CI (`odoo19` job) |

## Status matrix

| ID | Original severity | Verified severity | Root cause | Changed files | Tests | Status |
|---|---|---|---|---|---|---|
| PP-01 | P0 | P0 | `idempotencyKey` was optional on `/api/print/jobs`; a retry without a key created a second queued job and could print twice. | `src/app/api/print/jobs/route.ts`, `src/app/api/print/jobs/v2/route.ts` (new), `API.md` | `tests/print-idempotency.test.ts` (v1/v2 parity, concurrency, conflict, reprint) | **PARTIALLY MITIGATED** — v1 still accepts a missing key (returns `X-Idempotency-Warning`); the additive v2 contract requires it. Mandatory v1 removal needs approval. |
| PP-02 | P2 | P2 | — | — | `tests/ambiguous-print-outcome.integration.test.ts` (new), `tests/ws-claim-delivery.test.ts` | **VERIFIED EXISTING PROTECTION** — the invariant is now proven end to end: an ambiguous outcome stays terminal-failed with an unknown marker, is never requeued by the sweeper, keeps its claim fence for reconciliation, and a provably undelivered claim is safely requeued. A real delivery keeps valid `deliveredAt` evidence. |
| PP-03 | P2 | P3 | — | — | — | **VERIFIED EXISTING PROTECTION** — the poll claim predicate re-evaluates printer eligibility each time, so a recovered printer re-claims its queued jobs. |
| PP-04 | P2 | P2 | `STALE_PRINTING_SECONDS` was a hard-coded 10-minute execution lease with no override. | `src/lib/stale-threshold.ts`, `src/lib/job-maintenance.ts`, `.env.example` | `tests/client-stale-threshold.contract.test.mjs` | **CONFIRMED — FIXED** — `STALE_PRINTING_SECONDS` env override (clamped 120–3600), default unchanged at 600 s. The Agent's own print budget (2m + 30s/MB, ≤ ~4.5 min) stays well inside the default, and an over-long job keeps its claim fence for late-success reconciliation. |
| PP-05 | P2 | P3 | — | — | — | **VERIFIED EXISTING PROTECTION** — the 90 s claim lease is env-tunable; a failed WS send requeues immediately. |
| PP-06 | P1 | P1 | `releaseUndeliveredClaim` requeued a claim whose retry budget was already exhausted; the job was then unclaimable and stuck until expiry. | `src/lib/job-delivery.ts` | `tests/job-release-guard.integration.test.ts` | **CONFIRMED — FIXED** — exhausted claims now terminate as failed. |
| PP-07 | P2 | P3 | — | — | — | **FALSE POSITIVE** — the 64 MiB poll budget is below the Agent's 100 MiB read limit; the WS frame cap (8 MiB) is compared against the Agent's own limit. |
| PP-08 | P3 | P3 | — | — | — | **FALSE POSITIVE** — the Gateway budget is a strict subset of the Agent's accepted size. |
| PP-09 | P3 | P3 | — | — | — | **FALSE POSITIVE** — the receipt conflict is unreachable: every materialisation path inserts and deletes in one transaction under row locks. |
| PP-10 | P3 | P3 | — | — | — | **VERIFIED EXISTING PROTECTION** — the timeline is documented as a diagnostic aid, not a durable guarantee; degraded mode is visible via `evidence.source`. |
| SEC-01 | P1 | P1 | The 6-character pairing code (~30 bits) was stored as a plain SHA-256 hash, so a leaked database row could be reversed offline. Agent secrets (192-bit) and Odoo API keys (256-bit) are correctly fast-hashed. | `src/lib/agent-auth.ts`, `SECURITY.md` | `tests/pairing-code-contract.test.ts` | **CONFIRMED — FIXED** — the pairing code is now an HMAC over an HKDF-derived server-side pepper; high-entropy secrets keep their fast hash. |
| SEC-02 | P1 | — | — | `src/server/trusted-proxy.ts` (comment only) | `tests/trusted-proxy.test.ts` | **VERIFIED EXISTING PROTECTION** — missing `Origin` was already accepted for native Agents, with bearer-secret auth still required. |
| SEC-03 | P1 | — | — | `src/lib/auth-rate-limit.ts` (notice severity only) | — | **VERIFIED EXISTING PROTECTION** — production startup already refuses a non-loopback bind without `TRUST_PROXY=1`. |
| SEC-04 | P2 | P2 | Security controls live in the custom `server.ts`; `next start` would bypass CSP and proxy enforcement. | `package.json`, `Dockerfile` | `tests/architecture-hardening.test.ts` ("serves production only through the CSP-owning custom server") | **VERIFIED EXISTING PROTECTION** — the contract test pins `npm start` → `server.ts`, forbids a `start:next` script, and pins the Docker `CMD`. A contract test also pins `proxy.ts` as a transparent pass-through, so no second CSP can be minted in another hosting mode. |
| SEC-05 | P2 | P3 | — | — | — | **PARTIALLY MITIGATED** — file-backed secrets are cached for 30 s, so rotation takes effect within that window. |
| SEC-06 | P2 | P2 | Pinned base images carried HIGH advisories under a time-bound exception. | `Dockerfile`, `docker-compose.yml`, `docker-compose.ci.yml`, `.github/workflows/docker.yml`, `.nvmrc`, `security/image-vulnerability-baseline.json` | CI `docker-image-scan` (Trivy) | **CONFIRMED — FIXED** — the real CI scan showed where every finding lived: node 24.21.0 → 24.22.0 (7 → 3 findings, all in npm's own bundled deps) and caddy 2.11.4 → 2.11.7 (20 → 4 findings, all in the Go binary). The baseline now records the actual scan result for each exact digest. |
| SEC-07 | P3 | P3 | — | `scripts/audit-gate.mjs` | `scripts/audit-gate.mjs` (CI `npm dependency audit`) | **VERIFIED EXISTING PROTECTION** — `braces` has NO upstream patch (GHSA-vfj7-8cjw-p6xm, affected <=3.0.3). The CI audit gate keeps the full `high` threshold and allowlists exactly this one dev-only advisory, failing if it ever becomes a runtime dependency or stops being reported. |
| SEC-08 | P3 | P3 | — | — | — | **INTENDED BEHAVIOR** — `style-src-attr 'unsafe-inline'` is required by the Radix runtime styles; the script policy stays strict with a nonce. |
| SEC-09 | P3 | P3 | — | — | — | **INTENDED BEHAVIOR** — the access cookie is `SameSite=Lax`; the refresh credential is `Strict` and path-scoped. |
| SEC-10 | P3 | P3 | — | — | — | **INTENDED BEHAVIOR** — 169.254.0.0/16 is blocked except the two cloud metadata addresses, which are themselves blocked. |
| SEC-11 | P3 | P3 | — | — | — | **INTENDED BEHAVIOR** — Stripe signature verification plus a 300 s tolerance and event-id replay table. |
| SEC-12 | P3 | P3 | — | — | — | **INTENDED BEHAVIOR** — the liveness probes are deliberately proxy-exempt and return no sensitive data. |
| SEC-13 | P3 | P3 | — | — | — | **INTENDED BEHAVIOR** — the 400/409 distinction is an operator-diagnosis aid; both outcomes require a valid one-time code. |
| SEC-14 | P3 | P3 | The PostgreSQL image exception expired 2026-10-26. | `security/image-vulnerability-baseline.json` | CI `docker-image-scan` | **CONFIRMED — FIXED** — re-reviewed 2026-10-20 ahead of expiry. All 25 findings are in `/usr/local/bin/gosu`, the prebuilt setuid helper upstream ships in EVERY postgres 16 and 17 image, so no image bump can shrink the set. The finding list, the `reviewNotes` rationale and a new 2026-11-26 expiry are recorded in the baseline. |
| TEN-01 | P1 | P2 | The initial Agent lookup is by Agent id alone; tenant is derived from the row. | — | `tests/agent-identity-isolation.integration.test.ts` (new) | **VERIFIED EXISTING PROTECTION** — `agents.id` is the table primary key, so the lookup is globally unique; the tenant comes from the authenticated row, never from the client. The adversarial test proves a lookalike id resolves to its owning tenant and a wrong secret never resolves. |
| TEN-02 | P1 | P2 | The WebSocket registry and rate-limit buckets are keyed by Agent id. | — | `tests/agent-identity-isolation.integration.test.ts` (new) | **VERIFIED EXISTING PROTECTION** — Agent ids are globally unique primary keys, so no two tenants can share one. The adversarial test proves a foreign Agent can neither claim nor release another tenant's job. |
| TEN-03 | P1 | P1 | Legacy session revocation was not tenant-scoped. | `src/lib/manager-auth.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/auth/manager/logout/route.ts` | `tests/tenant-scoped-session-revocation.integration.test.ts` | **PARTIALLY MITIGATED** — single-session revocation is tenant-scoped; account-level password/email events intentionally revoke every tenant of that account. |
| TEN-04 | P2 | P2 | Retention sweep reads/deletes job rows by id without a tenant predicate. | — | — | **VERIFIED EXISTING PROTECTION** — job ids are globally unique primary keys, and the sweep runs under a global advisory lock. |
| TEN-05 | P2 | P2 | Platform/legacy session revocation by JTI is not tenant-scoped. | — | — | **VERIFIED EXISTING PROTECTION** — JTIs are random primary keys, so a JTI identifies exactly one session. |
| TEN-06 | P3 | P3 | — | — | — | **INTENDED BEHAVIOR** — fleet metrics are platform-wide aggregates by design. |
| TEN-07 | P3 | P3 | — | — | — | **INTENDED BEHAVIOR** — the verification-request cache is a client-side de-duplication, keyed by the unguessable token. |
| TEN-08 | P3 | P3 | — | — | — | **INTENDED BEHAVIOR** — the database-clock offset and platform-stats caches are process-global by design. |
| TEN-09 | P3 | P3 | — | — | — | **INTENDED BEHAVIOR** — the client verification cache is token-keyed in the browser. |
| BILL-01 | P1 | — | — | — | `tests/billing-entitlement-access.test.ts` | **INTENDED BEHAVIOR** — `past_due` retains access during Stripe recovery by design (documented in `OPERATIONS.md`, `API.md`, `README.md`). |
| BILL-02 | P1 | P1 | A terminal deletion event bypassed the event-timestamp gate and could cancel a newer active subscription. | `src/app/api/billing/webhook/route.ts` | `tests/billing-webhook.test.ts` ("5f") | **CONFIRMED — FIXED** |
| BILL-03 | P1 | P1 | An unrecognized Stripe status was collapsed to `cancelled`, silently revoking access and erasing checkout state. | `src/app/api/billing/webhook/route.ts`, `src/app/api/billing/checkout/route.ts` | `tests/billing-webhook.test.ts` ("6b") | **CONFIRMED — FIXED** |
| BILL-04 | P1 | P2 | The Odoo read surfaces check billing outside a transaction. | `src/lib/e2e-capture.ts` | `tests/e2e-capture-postgres.test.ts`, `tests/e2e-capture-admission.test.ts` | **PARTIALLY MITIGATED** — the read surfaces stay tenant-scoped and expose no credentials. The write surface (E2E capture) now re-decides billing access INSIDE its insert transaction, so a subscription that lapses between the route check and the insert can no longer create a run row. The read surfaces still have a one-response TOCTOU window by design (pinned by `tests/odoo-billing-boundary.contract.test.ts`). |
| BILL-05 | P2 | — | — | — | — | **FALSE POSITIVE** — READ COMMITTED does not block the plan read; the exposure is one in-flight print during a downgrade. |
| BILL-06 | P2 | P2 | `max_concurrent_jobs` ignores rows whose TTL has passed but which the sweeper has not reclassified yet. | — | — | **PARTIALLY MITIGATED** — over-admission is bounded by the number of expired, unswept in-flight rows, admissions are serialized per tenant by an advisory lock, and the Agent-side in-flight ceiling (64) backstops physical concurrency. Changing the count semantics is a quota-policy change and needs product approval. |
| BILL-07 | P3 | — | — | — | — | **INTENDED BEHAVIOR** — the window is a submission-rate limit, matching "jobs / minute". |
| BILL-08 | P2 | P2 | A mid-period plan downgrade blocks prints until the period resets: the usage bucket is keyed by `(tenant_id, period_start)` and never reset, so `used_prints` (e.g. 50) can exceed the new limit (e.g. 20) and every later print is rejected with 429 `PRINT_QUOTA_EXCEEDED`. | — | — | **BLOCKED — PRODUCT DECISION** — every candidate fix changes customer-facing quota behaviour (grandfather the higher limit, reset the bucket on plan change, or prorate). No code change was made; this needs an explicit commercial decision. |
| BILL-09 | P3 | — | — | — | — | **VERIFIED EXISTING PROTECTION** — the app guard mirrors the database `period_end > period_start` invariant. |
| BILL-10 | P3 | — | — | — | — | **FALSE POSITIVE** — a `hashtext` collision only adds serialization. |
| BILL-11 | P3 | — | — | — | `tests/billing-webhook.test.ts` ("7", "8") | **INTENDED BEHAVIOR** — invoice events are payment facts; subscription lifecycle events own access state. |
| ODO-01 | P1 | P1 | The fail-closed notification told the operator to "check Print Activity" but never carried the operation reference, so the row could not be found. | `odoo_addons/print_gateway/static/src/js/report_interceptor.js`, `odoo_addons/print_gateway/i18n/ar.po` | `tests/test_odoo19_printing_static.py` | **CONFIRMED — FIXED** — the durable operation reference is surfaced on the fail-closed path. Fail-closed semantics are unchanged; no native fallback was added. |
| ODO-02 | P1 | P1 | The Gateway enablement probe failure produced no receipt and no actionable message; a naive native fallback there would print behind the operator's back. | `odoo_addons/print_gateway/static/src/js/pos_print_router.js`, `odoo_addons/print_gateway/i18n/ar.po` | `tests/test_odoo19_printing_static.py` | **CONFIRMED — FIXED** — the probe is wrapped in its own handler that states nothing was sent and that retrying is safe. Native fallback remains reachable only when the probe answered "disabled" definitively. |
| ODO-03 | P2 | P2 | Route exceptions collapsed to a generic message; the original exception was logged without a traceback. | `odoo_addons/print_gateway/models/binding.py` | `tests/test_odoo19_printing_static.py` | **CONFIRMED — FIXED** — the server log keeps the original exception and its traceback; the client-facing message stays generic. |
| ODO-04 | P2 | — | — | — | `tests/test_control_plane.py` | **VERIFIED EXISTING PROTECTION** — matches Odoo 19 semantics (empty `group_ids` means unrestricted). |
| ODO-05 | P2 | P2 | `print_job`/`print_intent` record rules were company-scoped only, so a branch job was invisible from root mode and the documented recovery path silently showed an empty list. | `odoo_addons/print_gateway/security/security.xml` | `odoo_addons/print_gateway/tests/test_branch_activity_visibility.py` (new, Odoo runtime), `tests/test_odoo19_printing_static.py` | **CONFIRMED — FIXED** — the rules now also match direct children of an activated company. A branch operator still cannot see the root's rows and no other Company's rows are reachable. |
| ODO-06 | P2 | P2 | The policy fan-out dedup key can collapse two distinct targets when binding resolution fails. | — | — | **VERIFIED EXISTING PROTECTION** — the surviving policy still produces a loud, visible failure. |
| ODO-07 | P2 | P2 | A branch intent was invisible to a root-mode operator, so it could not be re-armed from Automation Activity. | `odoo_addons/print_gateway/security/security.xml` | `odoo_addons/print_gateway/tests/test_branch_activity_visibility.py` | **CONFIRMED — FIXED** — same rule change as ODO-05. Dispatch was never stranded (the cron uses raw SQL). |
| ODO-08 | P2 | — | — | — | — | **FALSE POSITIVE** — the `1.1.0` pre-migration never runs under Odoo 19 version comparison. |
| ODO-09 | P3 | — | — | — | — | **INTENDED BEHAVIOR** — only `qweb-pdf` reports are printable. |
| ODO-10 | P3 | — | — | — | — | **INTENDED BEHAVIOR** — terminal rows are retained for reconciliation, not purged by hand. |
| ODO-11 | P3 | — | — | — | — | **INTENDED BEHAVIOR** — an unreachable Gateway returns no receipt rather than risking a duplicate. |
| ODO-12 | P3 | — | — | — | — | **INTENDED BEHAVIOR** — branch-scoped policies deliberately do not match sibling branches. |
| ODO-13 | P3 | — | — | — | — | **INTENDED BEHAVIOR** — a documented shortcut pending an offline print queue. |
| AGT-01 | P1 | P1 | A cancelled or timed-out USB write leaves the helper goroutine blocked in an uncancellable Win32 `WriteFile`. | — | — | **PARTIALLY MITIGATED** — bounded to one wedged device per printer by the in-memory latch. The block is inherent to `WriteFile` having no cancellation, so it needs Windows/hardware validation before any change. |
| AGT-02 | P1 | — | — | — | `SECURITY.md` | **INTENDED BEHAVIOR** — `CRYPTPROTECT_LOCAL_MACHINE` is required so the LocalSystem service and the user-context desktop manager can share one file. The threat model is documented. |
| AGT-03 | P2 | — | — | — | — | **FALSE POSITIVE** — the printer status probe takes no caller context; each timeout is paired with `defer cancel()`. |
| AGT-04 | P2 | P2 | The discovery watchdog force-released the semaphore after its bound, so a permanently wedged driver abandoned one goroutine every force-release window, forever. | `agent/internal/agent/discovery_manager.go`, `agent/internal/agent/agent.go` | `agent/internal/agent/discovery_abandoned_cap_test.go` (new) | **CONFIRMED — FIXED** — abandoned scans are now capped (`discoveryMaxAbandonedScans`). The first abandonment is still recovered by recycling the slot; past the cap the slot is deliberately NOT recycled, so no successor scan can start and no further goroutine can be leaked. The wedge stays visible via `discoveryWedged`. |
| AGT-05 | P2 | — | — | — | — | **INTENDED BEHAVIOR** — the 27 s stop boundary deliberately keeps SQLite open; WAL recovery is crash-safe. |
| AGT-06 | P2 | — | — | — | `SECURITY.md` | **VERIFIED EXISTING PROTECTION** — the at-rest weakness is documented and warned about at write time. |
| AGT-07 | P3 | — | — | — | — | **FALSE POSITIVE** — the drain keeps consuming past the cap and the resolver always closes the channel. |
| AGT-08 | P2 | P2 | The restart loop never closed the previous Agent instance, leaking a SQLite handle per crash. | `agent/cmd/agent/main.go`, `agent/cmd/agent/restart_release_test.go` (new) | `go test -race ./...` (1460 tests pass) | **CONFIRMED — FIXED** — the failed instance is released before the replacement is created, using the same "keep SQLite open while a handler is in flight" rule the service-stop path uses. |
| AGT-09 | P2 | — | — | — | — | **INTENDED BEHAVIOR** — WebSocket jitter uses the auto-seeded global source. |
| AGT-10 | P3 | — | — | — | — | **INTENDED BEHAVIOR** — the IPP transport is deliberately stricter than the control-plane transport. |
| AGT-11 | P2 | P3 | The printer registry used `os.Rename` instead of the shared atomic replace helper, losing the Windows write-through durability and the transient-lock retry. | `agent/internal/config/replace_file.go` (new), `agent/internal/printer/registry.go`, `agent/internal/printer/registry_atomic_replace_test.go` (new) | `go test -race ./...` | **CONFIRMED — FIXED** — the registry now uses `config.ReplaceFile`; the corrupt-file quarantine stays a plain rename to a new path. |
| AGT-12 | P3 | — | — | — | — | **BLOCKED — ENVIRONMENT** — Windows-only paths cannot be exercised on Linux. |

## Explicitly not changed

- **No public API contract changed.** `/api/print/jobs` keeps its v1 behaviour;
  v2 is additive.
- **No database migration added or modified.** All schema changes in this
  ledger are expressible with existing columns.
- **No billing grace period, quota policy or commercial behaviour changed.**
  BILL-01 and BILL-08 are documented rather than enforced.
- **No Odoo native-fallback behaviour changed.** A fallback requires durable
  proof that no cloud print was accepted, which the addon does not yet expose
  to the client.
- **No Windows Agent behaviour changed** without Windows validation (AGT-01,
  AGT-04).
