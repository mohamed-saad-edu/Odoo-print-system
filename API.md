# Gateway API

The Odoo integration contract is intentionally small. Odoo owns business records, destination/report context, bindings and print intent. Gateway owns runtime agents, printers, queues and physical execution.

## Odoo API key rotation

Rotating an Odoo API key creates a new key and immediately removes write capability from the previous key. The previous key remains read-only for 60 minutes so in-flight Odoo status synchronization can reconcile jobs created under the old credential. After that grace period the previous key is rejected completely. Update the Odoo installation with the new key during the grace window before removing the old key.

## Authentication

### Agent
`Authorization: Bearer <agent-id>:<secret>`.

### Manager
`mgr_session` cookie or manager bearer session, according to `src/lib/manager-auth.ts`.

Manager fleet reads `GET /api/agents` and `GET /api/printers` are bounded per request (`limit` maximum 1000). Legacy `offset` pagination remains supported up to 10,000 for compatibility and scan protection. Fleets can exceed that size because resource entitlements may be `unlimited`; callers that need deeper traversal must use keyset pagination instead of ever-increasing offsets. Pass the previous page's final `createdAt` and `id` as `beforeCreatedAt` and `beforeId`, or use `beforeCreatedAt` with `beforeIdEncoded` (canonical UTF-8 base64url). The timestamp and ID pair is required together and cannot be combined with a non-zero offset. Supplying both ID forms requires identical decoded values. Responses remain JSON arrays and expose `X-Has-More`; another page supplies `X-Next-Before-Created-At` and `X-Next-Before-Id-Encoded`. The legacy `X-Next-Before-Id` is also supplied for printable ASCII IDs; use the encoded form for Unicode, whitespace or control characters. Allowed desktop CORS origins can read these traversal headers and `X-Next-Cursor`/`X-Request-Id`. Ordering is stable by `(createdAt DESC, id DESC)`. These authenticated fleet responses are `no-store`.

`GET /api/printers/capabilities` returns a JSON array of capability/health matrices for a bounded page (default `limit=100`, maximum 1000), ordered by tenant-scoped printer ID. Read `X-Has-More` and pass the opaque ASCII `X-Next-Cursor` as `after` on the next request. The cursor is canonical base64url UTF-8 so Unicode IDs remain safe in HTTP headers. Pagination is applied before diagnostic projection; no offset or fleet-wide scan is needed. Inserts/removals during traversal follow normal keyset semantics, not a frozen fleet snapshot. `?printerId=<id>` retains the direct single-matrix lookup. Both forms require `printers.read` and are `no-store`.

Fleet status fields are evidence-based. `status` is the current effective presentation state: stale or missing Agent/printer observations resolve to `unknown`, not `offline` or the last reported value. `reportedStatus` retains the last raw device/Agent report for diagnostics, and `freshness` (`fresh`/`stale`/`missing`) states whether that report can be treated as current. Agent reachability and physical printer state remain separate facts.

### Odoo
`Authorization: Bearer odoo_<key>` or `X-Api-Key: odoo_<key>`.

Odoo Gateway authentication is based on the Odoo installation API key. The Odoo database name is not used as an authentication requirement. Odoo may still send `X-Odoo-Database` for informational purposes; the Gateway ignores it for authentication.

The raw Odoo key is returned only when generated. Gateway persists only its cryptographic hash plus lifecycle metadata; rotated keys use a bounded read-only grace window before full invalidation.

### Odoo status read authority

Status reads on `GET /api/print/jobs`, `GET /api/print/jobs/v2`, and
`POST /api/print/jobs/batch-status` require the saved installation identity for
v2 operations, in addition to the authenticated Odoo API key:

```text
X-Yaseir-Odoo-Idempotency-Version: 2
X-Yaseir-Odoo-Installation: <saved-installation-uuid>
X-Yaseir-Odoo-Proof: <saved-installation-proof>
```

The proof must belong to an enabled installation enrolled for the credential
and workspace. Both live jobs and durable receipts are restricted to that
installation's accepted-operation mapping. A valid proof for another
installation does not reveal the job, even when both installations share an
API key. Key rotation can preserve access within the same installation; the
historical job's API-key ID records provenance rather than requiring equality
with the current key.

Omitting the headers is allowed only while the workspace remains `legacy`,
and never grants access to an operation already mapped to v2. Strict-v2
workspaces reject missing proof with `403 INSTALLATION_NOT_ENROLLED`;
partial or unsupported version headers are rejected. Status responses are
`no-store` and project bounded metadata without fetching document payloads.

## `GET /api/odoo/health`

Authenticated with the Odoo installation key. Returns the authenticated integration health, including its replicated Odoo activation state (`enabled`). This endpoint is used by the Odoo **Test Connection** button.

## `PATCH /api/odoo/configuration`

The active Odoo integration key sets the integration's replicated `enabled` boolean
and monotonically increasing `revision`. `revision` must be an integer between
`0` and `2147483647`, inclusive (the backing PostgreSQL column is signed
`integer`/int4); out-of-range inputs receive `400` before any database write.
A rotated read-only key cannot change activation (`409 API_KEY_READ_ONLY`).
Enabling must hold a live billing entitlement; disabling remains possible
without one. The Gateway locks the credential before checking the subscription,
matching Odoo print admission's lock order to avoid a key/subscription deadlock.
Manager revocation/erasure cannot be blocked by activation-revision overflow:
its terminal revision saturates at the int4 maximum.

## `GET /api/odoo/printers`

Authenticated with the same Odoo installation key. Returns a sanitized list of non-retired runtime printers and agent display information. This is read-only runtime discovery for the Odoo Print Binding selector; the endpoint never creates or changes printers and does not return agent secrets.

`capabilities.supported_protocols` contains the Gateway-admitted document languages. Optional `capabilities.paper_width_mm` is the selected physical 58/80mm roll, or a single unambiguous reported roll size; it is omitted for missing, malformed or ambiguous media. `printableWidthDots` is a separate usable raster-width measurement and must never be interpreted as physical millimetres. The Odoo controller retains the same bounded media field. Gateway/Odoo document diagnostics use that roll with 100mm ticket length; ordinary report PDFs retain their own page dimensions. See `contracts/print-payload-contract.json` (`diagnosticPage`).

## `POST /api/print/jobs`

Request:

```json
{
  "printerId": "runtime-printer-id",
  "documentType": "receipt",
  "destination": "Main POS",
  "payload": {
    "type": "pdf",
    "encoding": "base64",
    "data": "JVBERi0xLjQK..."
  },
  "expiresAt": "2026-09-07T15:00:00Z",
  "idempotencyKey": "stable-for-one-logical-print"
}
```

No Gateway branch ID, Gateway destination ID, Gateway document-type ID, agent provisioning data, or printer-creation data is accepted.

The Gateway validates the Odoo key, payload, expiration and idempotency before queueing the runtime job. The Odoo installation key is a credential for the Odoo integration API surface documented here. It is not a Manager or Platform credential and is not accepted by generic console endpoints. It is not restricted by document type. A created Odoo-originated job is stamped with the authenticated API-key identity. Status lookup follows the installation proof and legacy restrictions in **Odoo status read authority** above. Internal Manager-created jobs without Odoo API-key provenance remain outside the Odoo integration flow.

`201` means a new job was accepted. `200` means an idempotent retry matched an existing job and returns that job identity. A reused key with different routing/payload data returns `409 IDEMPOTENCY_CONFLICT`. Idempotent replay is checked within the same transaction as the integration's **current credential and workspace authorization**; a key revoked, rotated to read-only, or disabled after initial HTTP authentication cannot reuse an old receipt to bypass authorization. A historical terminal receipt can still be reconciled if its original printer or Agent record has been removed, using a separately fenced **read-only recovery** path that never submits a new print or consumes another quota credit. This receipt replay is not evidence that paper came out.

**Idempotency key requirement:** In production, `POST /api/print/jobs` requires a stable `idempotencyKey` by default; `POST /api/print/jobs/v2` requires it in all environments. A missing key returns `400 IDEMPOTENCY_KEY_REQUIRED` and no job is queued. Reuse the same key for retries of one logical operation. First-party Odoo callers already send stable company-namespaced operation IDs; an intentional reprint requires a distinct new key.

**Legacy migration escape hatch:** Set `YASEIR_REQUIRE_IDEMPOTENCY_KEY=0` only for temporary keyless v1 compatibility and accept its duplicate-printing risk explicitly. Development/test accept keyless v1 by default; `YASEIR_REQUIRE_IDEMPOTENCY_KEY=1` enables strict admission. Production Compose defaults to `1` and production code defaults to strict when unset. v2 is always strict. Never automatically retry uncertain physical delivery.

Typical failures include `400` invalid input, `401` authentication failure, `404` unknown runtime printer/job, `422 CAPABILITY_MISMATCH` when the payload cannot be delivered by the selected printer, `429 PRINT_JOB_RATE_LIMITED`, `503` runtime/queue availability failure and `500` internal failure. Gateway-enabled Odoo printing never converts these failures into browser/native printing.

## `GET /api/print/jobs?id=<jobId>`

Authenticated with the Odoo API key and the saved v2 installation proof where applicable. Returns runtime status and routing metadata for an authorized Odoo operation. A job belonging to another tenant or installation, or a non-Odoo job, is returned as `404 Not found`. The same authority applies to the `/v2` route and idempotency-key lookups. See **Odoo status read authority** for legacy behavior and rotation.

## Agent heartbeat pagination

`POST /api/agent/heartbeat` is the Agent runtime inventory and liveness contract. The `500` printer limit is a per-request page ceiling, not a tenant or Agent fleet-size ceiling.

The current Agent sends:
- `heartbeatPage`: 1-based page number.
- `heartbeatPageCount`: total number of pages in this heartbeat cycle.
- `inventorySnapshotId`: one safe token shared by all pages in a cycle.
- `inventorySnapshotVersion`: a positive int64 decimal **string**, shared by all pages. Never encode it as a JSON number: nanosecond-seeded values exceed JavaScript's exact integer range.
- `inventoryComplete`: whether the local registry was read authoritatively.
- `printers`: at most 500 entries per page and no more than 256 KB of serialized printer metadata per page.
- `desiredStateAcks`: at most 500 entries per page.
- `privatePrinterIds`: at most 500 already-known private IDs per page; no private printer metadata is sent. Shared printer observations explicitly include `sharedWithGateway: true`.
- `gatewayOwnedPrinterIds`: the Gateway-owned IDs represented on that page, used to preserve the manager-owned/deletion fence.
- `keepAliveJobIds`: the existing bounded execution keep-alive set.

Complete inventory snapshots require an explicit `printers` JSON array. `[]` declares an empty inventory; an omitted or non-array list returns `400` before any presence or inventory mutation. Legacy presence-only heartbeats may omit `printers`.

Each inventory page requires a valid JSON response with `success: true`, not merely HTTP 2xx. If an intermediate page is rejected or its acknowledgement is malformed, the Agent stops that heartbeat cycle without sending the final inventory page. A rejected final acknowledgement keeps manager-owned printing fenced. The next scheduled heartbeat starts a new snapshot; absence reconciliation is never authorized by partial delivery.

Agents with more than 500 printers send multiple pages. Legacy heartbeats without page fields are treated as a single inventory page. The final inventory page returns manager-owned `desiredState`. Current Agents send `desiredStatePaging: true`: each desired-state page contains at most 64 rows and 512 KiB of JSON array data, scoped to the authenticated tenant and Agent. A non-empty `desiredStateNextCursor` continues through `GET /api/agent/desired-state?after=<cursor>`; that response also identifies its owning `agentId`. Cursors are canonical UTF-8 base64url IDs in ascending-ID order. No continuation cursor means the last page.

The Agent accumulates every page before applying authoritative absence reconciliation, with a 45-second synchronization deadline, a 1 MiB continuation-response bound and an 8 MiB compact metadata budget. The serialized durable desired-state file remains capped at 16 MiB. An interrupted, malformed, repeated-cursor, wrong-owner, oversized or unpersisted snapshot leaves manager-owned execution fenced and does not authorize deletion from a partial page. Gateway printing admission still independently requires current desired revisions, lifecycle and the exact claim fence; changing configuration during traversal therefore cannot authorize a stale physical attempt.

Older Agents receive a complete small snapshot. If the state requires paging, Gateway omits the authoritative array and returns `desiredStateUpgradeRequired: true`, with an operational warning; upgrade that Agent to restore manager-owned printing. A truncated array is never presented as a complete snapshot. These are metadata/work bounds, not plan cardinality limits; distribute unusually large configuration volumes across Agents.

Snapshot ordering is checked under the Agent row lock before any presence, metadata, liveness or keep-alive write. A first page must exceed the retained version; every continuation must use that exact version, token, page count and expected page. The version survives final-page completion and Gateway restarts. A stale, replayed or downgraded request returns `409 INVENTORY_SNAPSHOT_CONFLICT` with `minimumSnapshotVersion` as a decimal string. The Agent advances its process counter from that value and starts a new cycle, so clock rollback or a process restart does not require clock synchronization.

Only an ordered, versioned, complete and error-free final page can mark missing Agent-owned printers absent. Legacy clients without a version may add/refresh observations before the first versioned writer is accepted; they cannot declare absence. Once a versioned writer is established, versionless writes are refused. Deploy migration `0080`, then the Gateway, then upgrade Agents; downgrading an Agent requires deliberate re-pairing rather than weakening the retained fence.

Agent-owned printer registration remains subject to the tenant plan's `max_printers` entitlement. Exceeding that capacity returns `429 MAX_PRINTERS_EXCEEDED`; existing printer observations are not a substitute for entitlement and manager-owned printers remain governed by desired state.

Sharing controls require the existing versioned, paginated snapshot tuple. Only rows owned by the authenticated tenant and Agent can be made private; unknown private IDs are ignored. A retained `sharedWithGatewayVersion` makes a negative decision win across same-version pages/replays. Re-sharing requires an explicit positive observation with a strictly newer version and available tenant capacity. Legacy observations without the sharing field cannot clear a denial. Apply forward migration `0084` before this Gateway/Agent release.

Default cloud inventories, Saved lists, Odoo selectors and current capacity/counts exclude printers with `sharedWithGateway: false`. Existing authorized by-ID/history access retains the canonical record and physical health. New print requests return `409 PRINTER_NOT_SHARED` after checking historical idempotency replay. WS/poll delivery and claimed-to-printing admission also require sharing; terminal/UNKNOWN results and outbox acknowledgments remain available. See `contracts/printer-sharing-contract.json`.

A claim-fenced Agent rejection `printer_not_shared` occurs before physical execution. Its existing queued error marker pauses that job even when the private inventory page has not arrived yet, preventing immediate repeated delivery. An accepted explicit positive observation clears matching queued markers without changing TTL or canonical sharing authority. A delayed rejection after re-sharing may wait for the next positive heartbeat; expiry and terminal reconciliation retain their existing rules.

## Agent registration response integrity

`POST /api/agent/register` accepts a bounded, single JSON object containing non-empty `agentId` and `secret` fields. The Agent requires HTTP 200 and a **complete** response of at most **1 MiB**, including trailing JSON whitespace. It refuses malformed, truncated, extra-value or oversized bodies **before saving** new credentials to the configured secure store. A partial HTTP success is not proof that Agent pairing completed. Redirects are disabled on pairing to avoid disclosing one-time pairing codes to another destination.

## Agent polling and discovery list framing

`GET /api/agent/jobs` returns a JSON array of at most **20** claimed jobs. The Gateway limits the encoded polling response to **64 MiB**; the Agent independently bounds received bytes to 20 times the maximum decoded payload size (**100 MiB**) before local admission. The Agent requires exactly one complete JSON array with no non-whitespace suffix, at most 20 non-null object entries, and a successful read through end-of-body. It validates the *entire* batch before admitting any job; oversized arrays are rejected after reaching the item cap rather than fully materialized. A rejected response does not prove its already-claimed jobs were printed or not printed; existing claim/lease reconciliation still applies.

`GET /api/agent/discovery` returns at most **5** pending session objects and has a separate **8 MiB** Agent read budget. Both background polling and targeted session lookup reject malformed, truncated, oversized or trailing-content replies; they do not start discovery for an unvalidated batch. These limits guard untrusted or incompatible Gateway responses; they do not authorize external printer scanning or change printer capability evidence.

## Runtime ownership boundary

Gateway APIs for Branches, business destinations, business document catalogs and Odoo-to-Gateway business synchronization are intentionally absent. Agents register runtime resources with Gateway; Odoo references those runtime printers only when creating bindings.

## Reliability contract

The Odoo addon commits a durable outbox row before making the HTTP submission. The same logical operation key is reused for retries. Legacy v1 operations retain their company-namespaced digest; v2 operations additionally use an independently enrolled installation namespace. Identical source IDs in different installations remain independent. Network timeouts are recorded as an unknown physical outcome instead of a definite failure. Credential rotation preserves the operation namespace. Status reads use each durable job's saved version and installation proof, including historical receipts, rather than the current configuration's identity.

## Agent expiry and uncertain delivery receipts

`PATCH /api/agent/jobs` accepts a claim-fenced `expired` report only once the Gateway database TTL has elapsed. If a `claimed` job has a pending WebSocket/poll handoff, a persisted Agent ACK, or a delivered timestamp, its expiry is classified as `UNKNOWN_PARTIAL_DELIVERY` (physical outcome `unknown`), **not** as proof that it did not print. The expiry classification is calculated by PostgreSQL from the row at update time so concurrent ACKs are not lost. No fake `delivered_at` timestamp is created solely because a handoff might have occurred. A late authenticated `success` from the **same** preserved claim token can reconcile that uncertain outcome within the existing five-minute TTL grace window; it never enqueues another print. An expired job with no claim and no possible-delivery evidence cannot be promoted. This contract applies equally to receipts, kitchen/bar tickets, reports, invoices, and every other Gateway print job type; it does not establish paper-output verification.

- If the Gateway lease sweeper marks a still-claimed request `failed` with
  `UNKNOWN_PARTIAL_DELIVERY` after possible polling/WebSocket handoff, the
  original Agent can reconcile a delayed `success` using its exact retained
  claim token even when neither `delivered_at` nor `acked_at` exists. The
  persisted unknown-outcome marker, claim identity, and 24-hour database age
  fence are required; a new claim/reprint is not issued. This records Agent
  submission evidence, not proof of physical paper output.

## Customer SaaS authentication and billing

Customer authentication uses `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/verify-email`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, and `POST /api/auth/select-tenant`. The `/api/auth/me` browser probe also accepts Manager workspace sessions; their refresh stays at `/api/auth/manager/refresh`. Legacy manager bootstrap endpoints remain under `/api/auth/manager/*`.

When valid customer credentials have multiple active workspace memberships,
login returns `409` with a short-lived `selectionToken`, the existing
`workspaces: string[]`, and additive `workspaceOptions: [{ id, name }]` display
metadata. Unrelated, suspended and erased workspaces are excluded. No session
is issued until the selected active membership is revalidated. These responses
are `no-store`; names never replace membership IDs as authorization input.

An optional `tenantId` on password login selects that exact active membership.
If supplied, it must be a nonempty string of at most 128 characters. Invalid
types, empty values and oversized IDs return `400 INVALID_REQUEST` without
issuing a session; they never become automatic workspace selection.

Workspace settings use `GET/PATCH /api/settings`. `/api/onboarding` and `/api/subscription-requests` deny workspace commercial actions with `403 PLATFORM_OWNER_REQUIRED`. Team directory reads use `GET /api/team/members`; workspace invitation, member-mutation and ownership-transfer endpoints deny workspace tokens. `POST /api/team/invitations/accept` retains its restricted recipient-proof workflow. Platform Owner administration uses `/api/platform/tenants/:id/members`, `/invitations` and `/ownership` with dedicated platform authority. The workspace member directory is bounded and paginated using `limit`/`offset` (default 50, maximum 100), with `hasMore`, `offset`, `limit` and tenant-scoped `total`.

Manual subscriptions expose `GET /api/billing/plans` as a public active/public catalog and `GET /api/billing/status` as a non-commercial availability probe for live workspace members. `GET /api/billing/usage` requires the denied workspace `billing.read` permission; commercial quota and subscription administration belongs to the Platform Owner. Historical activation requests remain administrative evidence, not customer write authority.

The Platform Owner manages plans in the UI or provisions missing public plans with `npm run db:provision-plans` using `YASEIR_PLAN_CATALOG` JSON. Monthly logical print jobs are the commercial allowance; Agents, printers and members have no commercial count cap. Technical resource and request limits remain enforced. `POST /api/billing/checkout`, `/portal`, `/cancel`, `/resume` and `/webhook` are retired and return `410 MANUAL_BILLING_REQUIRED` without external provider calls or subscription writes. Historical provider records remain retained.

`POST /api/platform/tenants/:id/subscription` accepts the supported save, renew, extend, suspend, reactivate, cancel-at-end and revoke actions. It requires Platform Owner authority, recent password proof, a UUID idempotency key, expected revision and an administrative reason. Save/renew include plan, free/paid type, monthly quota, term, dates and target status; an optional request ID links approval to its original requester. The transaction preserves before/after history and rejects stale or incompatible replay with 409. Platform request rejection and workspace suspension/reactivation carry corresponding actor-bound idempotency and stale-state fences. New team invitations expose only Full Access (`admin`) and are controlled by the Platform Owner; workspace ownership is an informational marker, not team-management authority.

## `POST /api/print/jobs/batch-status`

Authenticated with the Odoo API key and saved v2 installation proof where applicable. Request at most 100 job statuses using the authority described above. The addon groups batches by each job's saved identity version and installation.

Request:

```json
{
  "jobIds": ["job-1", "job-2"]
}
```

Response:

```json
{
  "jobs": [
    {
      "jobId": "job-1",
      "status": "success",
      "printerId": "runtime-printer-id",
      "agentId": "agent-id",
      "destination": "Main POS",
      "documentType": "receipt",
      "error": null,
      "deliveredAt": "2026-09-07T15:00:00.000Z",
      "ackedAt": "2026-09-07T15:00:05.000Z",
      "updatedAt": "2026-09-07T15:00:05.000Z"
    }
  ]
}
```
Only Odoo-originated jobs authorized by the installation scope (or unmapped v1 jobs in a legacy workspace) are returned. Unknown or unauthorized IDs are omitted. The current API key need not equal the historical provenance key, so valid rotation within the same installation does not strand synchronization. Document payloads and credentials are never included.

Discovery reports use the additive `errors: string[]` contract in `contracts/print-payload-contract.json` (maximum 64 messages, 2048 UTF-16 units each). The Gateway returns these in session `stats.errors`; optional unavailable device fields are omitted, and protocol defaults to `unknown`. Odoo consumes approved runtime printers, not discovery candidates or source diagnostics; no addon producer emits discovery reports.

Discovery device IDs are local to the reporting Agent within its workspace. Approval and provisioning URLs carry both Agent and device IDs; identical device IDs from another Agent neither collide nor inherit approval. Existing external IDs and runtime-printer links are preserved.

Historical provider-normalization helpers and database fields are retained for evidence and compatibility inspection. They are not active V4 billing routes and cannot activate or renew a workspace through the retired provider endpoints.

New physical dispatch requires an acknowledged, claim-fenced `printing` response (`success: true`, `status: "printing"`). Local delivery receipt age is diagnostic only; a buffered frame may already have a stale claim. An unacknowledged admission sends no hardware bytes. Printing that already crossed this boundary retains its durable outcome reporting through a later disconnect. Repeated admission for the same live printing claim is acknowledged without creating another job or physical attempt.

Printer destinations permit private IPv4 and IPv6 ULA (`fc00::/7`) or link-local literals across Gateway and Agent. Loopback, unspecified, multicast and instance metadata endpoints remain rejected; metadata rejection applies to equivalent expanded IPv6 spellings.

Terminal Agent reports echo their immutable attempt claim token. Matching closed-attempt SHA-256 evidence permits acknowledgement retries of the same terminal status only; it cannot authorize execution, replace evidence or extend reconciliation age. Agents retain terminal outbox tokens until the JSON response confirms success and the requested status. New claims clear closed acknowledgement evidence.

Delivery callbacks and `job_ack` preserve their first evidence timestamps. Replays do not renew the claim lease, and admission ACKs arriving after `printing` do not renew execution. Only fresh execution progress may keep a printing lease alive; a stalled delivered claim still becomes UNKNOWN without automatic reprint.

An Agent may return a delivered/ACKed `claimed` job before printing admission with a recognized pre-execution rejection reason and its current claim token. The atomic update requires remaining TTL/retry budget, clears delivery evidence and refunds the delivery attempt. Stale claims and attempts already admitted to `printing` reject this hand-back; explicit crash recovery remains separate.

Discovery provisioning creates manager-owned printers at desired revision 1 so the owning Agent receives and applies their newly allocated runtime IDs. Existing exact network endpoints, spooler queues and matching stable runtime identities converge instead of allocating duplicate targets. IPP IPv6 URLs retain brackets and separate resource paths.

Rediscovery invalidates candidate approval when transport, endpoint, queue, device class or capabilities change. The existing provisioned printer link remains historical evidence; its manager-owned configuration never changes implicitly. A changed candidate requires fresh review before provisioning.

Refresh rotation, password reset, membership edits, ownership transfers and workspace switching serialize on the affected users before family/token writes. Ownership transfers acquire both users in sorted ID order. A rotation either precedes a revocation (and its successor is revoked) or validates after the authoritative principal change.

Cached test-connection responses retain `live:false` and expose `printerLastSeenAt`/`printerObservationFresh`. Reachability requires fresh printer observation as well as a fresh online active Agent; a new Agent heartbeat alone cannot revive an old printer observation.

Billing status includes `entitlementBlocked` and the canonical customer state: awaiting_activation, active, expired or suspended. Effective access requires an active tenant, unblocked manual subscription, reached start date and an unexpired end where one is recorded. Retained legacy open-ended contracts remain explicit; new manual save/renew operations require valid dates. UI status uses database time and the same lifecycle/date semantics; recorded status alone is not proof of active access. Optional plan metadata still requires `billing.read`.

Quota admission atomically increments `print_monthly_usage` for the authoritative UTC calendar month, once per newly accepted logical job. Pages/copies do not multiply this charge; rejected admission and exact replay cost zero. Failure, cancellation or unknown physical outcome after acceptance does not refund the admission. Renewal, quota edits and plan changes do not reset usage. Annual contract end and next monthly quota reset are separate values.

Today/month/year operational totals deduplicate retained live jobs and completion receipts. Monthly allowance history uses its durable admission ledger. Migration 0095 preserves historical usage conservatively where old non-calendar periods cannot be reconstructed precisely; this can make cutover quota usage larger than reconstructed current-month reporting. See `MIGRATION.md` before upgrading.

Migration and route retirement do not contact any previous payment provider or cancel an external recurring charge. The release operator must reconcile prior external subscriptions separately. V4 accepts only explicit audited Platform Owner grants; payment screenshots, WhatsApp messages and browser query parameters are never settlement evidence or activation authority.

Terminal history cleanup removes document payloads and timeline events, retaining compact completion receipts. Accepted operation keys remain reserved for the tenant lifetime: identical retries return the original terminal job; mismatched requests return 409. Integration lookups by job ID/key and batch status remain available after cleanup. Closed Agent status replays require the original owner and hashed claim token. Manager job detail reports archived=true when only the receipt remains; archived jobs cannot be reprinted without resubmitting document content as a new explicit operation.

Platform tenant/subscription lists accept bounded offset and search, return limit and hasMore, and sort by creation time plus tenant ID. Subscription filter accepts all/active/attention/other; search and filters apply before pagination. Directory controls navigate 100-row pages rather than silently truncating 300 records.

Desktop local discovery IPC preserves optional agentId metadata from CLI JSON; absent owner provenance cannot authorize a discovered USB/spooler selection for another Agent. Gateway USB registration uses numeric 16-bit VID/PID, never hexadecimal strings or null/NaN.


### Explicit resource deletion and browser workspace sessions
Dashboard deletion now permanently removes an authorized Agent and its owned printers, including online or retired Agents. Job payload/event rows are removed only after compact operation receipts reserve their accepted keys. Undelivered work is cancelled; work carrying delivery/execution evidence retains an unknown physical outcome. The transaction invalidates Agent access and publishes the existing cross-instance session notification.
`DELETE /api/odoo/keys` with `{id, remove:true}` erases active or revoked credentials atomically and removes them from the list. A nonusable history reference retains accepted job attribution and Odoo reconciliation; the original credential hash and all access are removed. Ordinary `{id}` revokes without deleting and advances the activation revision.
`GET /api/auth/me` accepts the same Manager/Customer workspace cookies as the console, returns `kind` and permission names, and never returns credentials. Refresh-kind hints on 401 guide the browser to the existing kind-specific refresh route; Manager refresh cookies are scoped to `/api/auth/manager`.
Dashboard result actions return `{ok:true,data}` or `{ok:false,status,code,error}` so expected failures are not thrown into React production error masking. Full unexpected server diagnostics remain only in Gateway logs.

### Windows Agent fleet and discovery inventory

The main Windows Agent inventory follows named installed physical print queues plus explicitly registered/configured printers and Gateway-managed selections. Network/USB/SNMP/WSD/IPP scan observations remain available as setup candidates through discovery and provisioning; a successful probe alone does not add an automatic direct transport to the main fleet. `printers list` reads fast local/configured sources; `printers discover` keeps full bounded scan observations in its existing JSON response while persisting only main-fleet admissions. Historical candidate records remain recoverable and are not deleted by this policy. Queue/device health, observation freshness, and physical paper output remain separate evidence.

Queue discovery uses the caller's Windows installed/connected queues. Live UNC queue reads use Unicode `OpenPrinter2W` with `PRINTER_OPTION_NO_CACHE`; local queues keep `OpenPrinterW`. Queries share bounded native-worker ownership and preserve `unknown` on inaccessible, stalled or unverified queues. Registry remnants are setup candidates, not current executable queue evidence. Windows service and interactive-user visibility still depend on the account's installed connections. Status is sampled periodically; Windows driver/spooler reports are not physical-paper confirmation. See [Microsoft OpenPrinter2](https://learn.microsoft.com/en-us/windows/win32/printdocs/openprinter2).

Gateway dashboard and Agent desktop share four presentation states: `ready`, `printing`, `attention`, `unavailable`. Cloud readiness requires current owner Agent and printer observations; busy queues count as available. The desktop may independently display fresh locally read Windows health while cloud connectivity is unavailable; this does not authorize cloud test-print. Raw health, lifecycle, IDs, transport and localized Windows reasons remain in details. The dashboard state action accepts `printerStatus=all|ready|printing|attention|unavailable|saved`; existing raw-status filters remain supported. Default lists and fleet counts include shared, active currently-present physical printers. `saved` retains shared absent/inactive physical records and management actions; `fleet.savedPrinters` counts them. Private queues remain in the Agent local list and authorized historical/by-ID access. Actual Windows queue identity and driver/port evidence cannot be masked by a friendly alias: the shared guard and its server-only SQL counterpart exclude software/session queues before pagination and counting. HTTP `/api/printers` includes shared physical management records. Agent cards use `currentPrinterCount`; existing `printerCount` retains stored registrations for management confirmations.

Dashboard printer rows embed `agentStatus`, `agentLifecycle`, `agentLastSeenAt`, `agentStaleThresholdSeconds`, and `inventoryPresent`, so a paginated Agent list cannot turn a connected printer into an unavailable one. Missing owner evidence remains unavailable. A still-running, deferred or failed status probe reports `unknown` in the current heartbeat; it cannot refresh an old device status. Native detail belongs to the completed accepted probe snapshot, never stale configured metadata or a late worker. The presentation contract is `contracts/printer-presentation-contract.json`; it does not replace raw printer/job status enums or admission checks. Documents continue through the installed Windows driver/GDI; RAW output requires an explicitly declared byte protocol. Successful submission remains physically unverified until reconciled.
