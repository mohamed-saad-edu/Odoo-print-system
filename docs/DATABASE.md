# Gateway database reference

The Gateway uses PostgreSQL through the shared `pg` pool and Drizzle definitions in [`src/db/index.ts`](../src/db/index.ts) and [`src/db/schema.ts`](../src/db/schema.ts). This document describes the checked-in schema and migration process. It is not evidence that a deployment was migrated, backed up, restored, or tested successfully.

Production Compose separates bootstrap administration, migration ownership and
runtime DML. Runtime has no DDL, temporary-table, cluster-administration or
migration-ledger privileges. The explicit role job supports existing volumes
and records permission rollback metadata; see [PostgreSQL deployment roles](DATABASE_ROLES.md).

## Schema inventory

There are **32 current application tables**, **102 forward-only SQL migrations (`0000`–`0101`)**, and additional versioned forward repairs in [`scripts/db-migrate.ts`](../scripts/db-migrate.ts). The migration ledger, `drizzle.__drizzle_migrations`, is separate from the application tables.

| Table | Purpose and identity | Scope and relevant constraints |
| --- | --- | --- |
| `tenants` | Workspace identity, name, lifecycle and lifecycle timestamps | Primary key `id`; lifecycle is `active`, `suspended`, or `deleted` |
| `tenant_domains` | Workspace domain bindings and verification metadata | Tenant reference; globally unique domain; verification is explicit |
| `users` | Global account identity, password hash, email verification and Platform Owner flag | Globally unique email; partial unique index permits at most one Platform Owner |
| `tenant_users` | Membership and current role for a user in a workspace | Unique `(user_id, tenant_id)` identity and at most one owner per tenant; role CHECK; no formal primary key |
| `platform_sessions` | Revocation and cleanup of pre-policy Platform sessions; these sessions are never authorized | JTI primary key, user reference, expiry and revocation |
| `platform_session_security` | Per-family administrator assurance and freshness | Current salted-verifier fingerprint, password/activity timestamps, thirty-minute idle and eight-hour absolute expiry, revocation |
| `workspace_session_security` | Persisted workspace password proof and activity for each refresh family | Exact kind/tenant/user/credential binding and password time, thirty-minute idle, five-minute privileged confirmation and original absolute deadline; missing assurance denies access |
| `manager_sessions` | Revocation and cleanup of pre-policy workspace sessions; these sessions are never authorized | JTI primary key, tenant, optional user, role, expiry and revocation; not the current v2 access-token ledger |
| `refresh_tokens` | Hashed opaque v2 refresh credentials, family history and replacement/revocation evidence | Unique token hash; family/user/tenant indexes; kind/scope and time-order CHECKs; replacement self-reference |
| `email_verification_tokens` | Single-use mailbox verification credential hashes | User reference, unique token hash, expiry and consumed timestamp |
| `password_reset_tokens` | Password reset/setup credential hashes | User reference, unique token hash, expiry and consumed timestamp |
| `tenant_invitations` | Pending/accepted/revoked workspace invitations | Tenant and inviter references, unique token hash, expiry, bounded member role set excluding owner |
| `agents` | Paired Agent identity, hashed bearer secret, pairing-code hash/expiry, lifecycle and inventory snapshot progress | Tenant reference and unique `(tenant_id, id)`; global uniqueness for pending pairing-code hashes; separate runtime status and lifecycle |
| `printers` | Printer configuration, geometry and Agent verification, separate queue/device identity, desired/applied revisions, inventory presence and local sharing permission | Tenant-scoped `(tenant_id, id)` UNIQUE; composite tenant/Agent FK; partial UNIQUE `(tenant_id, agent_id, logical_queue_key)`; nonunique physical-device key; revision, verification and output-medium CHECKs |
| `api_keys` | Integration credential hashes, revocation/read-only grace and Odoo activation revision | Tenant reference, unique credential hash and `(tenant_id, id)`; read-only grace requires revocation |
| `odoo_installations` | Operator-enrolled Gateway identity for each independently managed Odoo deployment; proof hash, state and lifecycle | Unique tenant/installation ID; proof never stored in job/audit rows |
| `odoo_installation_credentials` | Preserved credential-to-installation ownership, including key rotations | Primary key `(tenant_id, installation_id, api_key_id)` and composite tenant/installation and tenant/API-key foreign keys; one key may serve several independent installations |
| `odoo_v2_operations` | Lifetime association of versioned Odoo business identity to original accepted Gateway job | Per-installation operation composite primary key, tenant-wide versioned-key unique constraint; no physical retry implied |
| `odoo_legacy_resolutions` | Explicit, audited operator decisions about old-key collisions | Tenant/installation uniqueness, immutable observed job fingerprint and decision (`reuse` or `distinct`) |
| `discovery_sessions` | Agent discovery run state, requested scan configuration and chunk/summary evidence | Composite tenant/Agent FK; at most one `running` session per tenant/Agent |
| `discovered_devices` | Agent-scoped observations within a tenant, candidate identity, verification and optional provisioned-printer link | Composite tenant/discovery, tenant/Agent and tenant/printer FKs; unique `(tenant_id, agent_id, id)` and non-null `(tenant_id, agent_id, identity_key)` |
| `print_jobs` | Admitted payload, immutable execution binding/output medium, bounded file evidence, state, claim/attempt fencing and delivery/acknowledgment timestamps | Composite tenant/Agent, tenant/printer and tenant/API-key FKs; unique non-null `(tenant_id, idempotency_key)`; payload/status/counter CHECKs |
| `job_events` | Per-job timeline and attempt/correlation metadata | Composite tenant/job FK with cascade on job deletion; bounded stage/status sets |
| `print_job_receipts` | Payload-free terminal receipt, retained execution binding/output evidence and idempotency identity after cleanup | Tenant reference, unique `(tenant_id, idempotency_key)`, fingerprint and terminal outcome; retained historical resource IDs are not all live FKs |
| `gateway_metrics` | Shared operational counters | Global metric-name primary key; nonnegative value; written by the metrics service |
| `audit_events` | Actor/action/resource audit metadata | Tenant is required except for Platform actor records; actor type CHECK and scope/time indexes |
| `auth_rate_limits` | Authentication attempt windows, failure counters and lockout expiry | Global opaque-key primary key; account/source-IP/pairing scope is encoded by the application, not a tenant column |
| `plans` | Public/private manual plan catalog and monthly print allowance | Global plan identity/name; active/public/display-order fields, plus optional USD/SAR display price in integer minor units |
| `tenant_subscriptions` | Manually approved plan, term, quota, status, revision and expiry | One row per workspace; plan reference; four allowed statuses, manually approved contract dates and immutable first-activation print-cycle anchor; no provider checkout columns |

Migration `0098` retires all Stripe and checkout columns from operational
`plans` and `tenant_subscriptions`. It moves `billing_events` and
`print_usage_periods` into the non-public `legacy_billing` schema and
archives legacy identities in `legacy_billing.plan_provider_history`
and `legacy_billing.subscription_provider_history`. Historical records are
kept strictly for audit and restore; the Gateway runtime and public explorer
do not use them. Explicitly approved manual subscriptions and the
`print_monthly_usage` ledger remain authoritative. See
[Manual-only database](MANUAL_ONLY_DATABASE.md) for the forward-only cutover.

The schema retains global account, catalog, metric and authentication data alongside tenant-scoped data. A missing `tenant_id` on a global table is not by itself an isolation defect. Conversely, the existence of a tenant column does not authorize access to a row.

## Isolation and state invariants

Isolation is enforced by authenticated tenant context, permission checks, ownership predicates and transactional revalidation in the Gateway. The supplied migrations do not enable PostgreSQL row-level security. Composite foreign keys add database enforcement where declared; they do not replace current-actor or tenant-lifecycle checks.

Printer registration IDs are unique within a tenant. Discovery observation IDs are unique within an Agent and tenant: two Agents can report the same local ID. Migration `0097` replaces the narrower tenant/ID constraint without changing IDs, rows, approvals or provisioned links. Candidate queries and mutations must include tenant, Agent and device ID. The migration is repeatable; rolling back to tenant/ID uniqueness requires first reconciling any newly admitted cross-Agent collisions without deleting data.

Keep printer lifecycle, observed health, inventory presence, sharing permission and physical print outcome separate. The database's physical-printer filters reject known virtual/redirected metadata patterns; they are not hardware attestation. An accepted or acknowledged print job is not universal proof of paper output. Claim tokens and terminal receipts support reconciliation; do not reset an uncertain job to `queued` by hand. See [OPERATIONS.md](../OPERATIONS.md).

`print_jobs_payload_contract_check` uses `COALESCE` to reject missing type/protocol discriminators on new or updated rows. Migration `0082` and its retained forward repair add this CHECK as **NOT VALID**: existing historical rows are not validated by that step. This must not be presented as proof that every old payload is valid. Application payload validation remains necessary.

`users_single_platform_owner_idx` and the tenant-owner partial unique index impose **at most one** owner at their respective scopes. They do not create an owner or guarantee that one exists. Account/bootstrap and ownership-transfer transactions enforce those workflows.

## Printer verification, identity and file output (migration 0094)

`capabilities.operational_verification` is produced by a successful live Agent probe. It is independent of geometry, operator approval, observed online status and a saved name/address. Only authenticated Agent inventory projects this evidence into `verification_state`, `verification_verified_at`, `verification_received_at`, `verification_binding_digest`, `logical_queue_key`, `physical_device_key` and `output_medium`. Manager registration starts pending; supplied capability evidence cannot mark it verified. Migration 0094 intentionally leaves all historical registrations pending until fresh proof arrives, retaining their IDs, lifecycle and job history.

Both the Agent observation time and Gateway receipt time must be within 300 seconds at new admission, claim and execution admission. Source-clock future tolerance is 60 seconds; a server receipt cannot be in the future. Manager configuration must also be applied and observed at its current desired revision, with the exact destination and protocol. Missing, malformed, failed, stale or mismatched proof removes eligibility. Timestamp-only discovery refreshes do not revoke a separate operator approval.

Identity has three scopes. `(tenant_id, id)` is the workspace registration identity. `(tenant_id, agent_id, logical_queue_key)` is unique for the canonical execution endpoint; in v1 that opaque SHA256 key equals the Agent binding digest. `physical_device_key` is an optional nonunique hardware identity: distinct logical queues can use one device. IPP UUID describes a printer service and does not, by itself, identify a physical chassis. The older `physical_identity_key` column is a versioned endpoint-deduplication key, despite its historical name. Its v2 canonicalization preserves internal Windows queue-name spaces, distinct USB interface paths and exact IPP resources. It never merges two Windows queues merely because their driver and port match. Uncertain collisions remain pending; disconnected/retired records and history remain available.

Every new job snapshots `binding_digest` and `output_medium` under the printer owner lock. Poll and WebSocket claims, plus transition to `printing`, require that snapshot to match the current verified target. A reconfigured registration cannot redirect an already admitted ordinary PDF to another queue or output profile. Null historical bindings are not manufactured: old queued work remains ineligible, while exact accepted/terminal reconciliation retains the original durable operation and never reprints it. Both fields survive payload cleanup in `print_job_receipts`.

Only `printer_type='file'`, `connection_type='pdf_output'`, `protocol='pdf'` and `output_medium='file'` identify approved file output. Public configuration contains an opaque `output_profile_id`; the Agent's local allowlist resolves the directory. Arbitrary virtual Windows queues remain blocked. A file job can report successful completion only with bounded `output_evidence`: `output_medium`, opaque `artifact_id`, lowercase SHA256, positive page count and positive byte count. Paths/filenames are rejected. Evidence is persisted atomically with the same-claim terminal transition, and exact terminal/archived replays must match it. File creation is displayed as `outputOutcome='file_created'`; it is never proof of physical paper output. Failed or unknown publication outcomes do not authorize an automatic second file creation.

## Authentication and sensitive data

Current browser access JWTs are short-lived and are not stored as refresh-token rows. The `refresh_tokens` table holds hashes of opaque refresh secrets, family history and revocation evidence. Validation also checks the live principal and current membership. Legacy workspace and platform sessions are denied because they lack current persisted assurance. Migration `0091` revokes pre-policy workspace families and legacy rows. Historical `0092` remains immutable; `0093` removes the retired factor stores and preserves all retained password/session deadlines and revocation state. No old or missing session is silently promoted. See [SECURITY.md](../SECURITY.md) for cookie, rotation and expiry behavior.

Agent and API-key columns contain credential hashes, not recoverable raw bearer secrets. Passwords use the account password-hashing implementation. Pairing codes use the deployment's configured keyed hashing policy. A database backup still contains sensitive data: credential hashes, account identifiers, print payloads, archived legacy billing events and operational metadata. Restrict database/backup access and apply deployment encryption and retention controls; the schema does not encrypt all of those columns. Preserve the independent JWT signing key through protected custody. Old backups containing retired factor material remain sensitive even though V3 does not read it.

Audit rows are persisted in PostgreSQL, but not every audit write is atomic with its business operation. Some paths write best effort after commit. The audit table is not an external alert-delivery service or an immutable storage boundary against a privileged database account.

## Connection and transaction behavior

The runtime accepts `DATABASE_URL` or structured `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` and password settings through the secret-loading implementation. The supplied Compose stack reads its database password from a mounted secret file. Never put real connection credentials in this reference or command logs.

The shared pool uses UTC sessions and UTC serialization for JavaScript dates. Most schema timestamps are timezone-naive and interpreted as UTC; `job_events.created_at` and `gateway_metrics.updated_at` are explicitly timezone-aware. Do not change session timezone or reinterpret historical naive values as local wall-clock times.

Current pool defaults are 20 connections, a 10-second connection timeout, 30-second idle/statement timeouts, a 5-second lock timeout and recycling after 10,000 uses. These are implementation settings, not throughput guarantees. Cross-instance claim/admission coordination uses PostgreSQL transactions, row/advisory locks and fenced state changes in the relevant services; process-local state alone is not the authority.

The shipped Compose profile separates bootstrap administration, a migration owner and a reduced-privilege runtime role. Its ordered role setup, owner-only migration and runtime verification jobs complete before Gateway starts. Runtime credentials cannot perform schema changes or read the migration ledger. Existing volumes require the explicit conversion and rollback procedure in [DATABASE_ROLES.md](DATABASE_ROLES.md).

## Applying migrations

With the intended database connection configured, the application command is:

```sh
npm run db:migrate
```

`scripts/db-migrate.ts` reads the Drizzle journal, begins a transaction, fixes the target `search_path` to `public`, and takes a database/schema-scoped transaction advisory lock. It checks recorded content hashes in `drizzle.__drizzle_migrations`, applies missing journal entries in order, then applies missing hash-addressed `AUDIT_REPAIRS`. Success commits; a failure rolls back the transaction.

Append new migrations or versioned forward repairs. Do not edit historical SQL/hash identities, delete migration-ledger rows to force replay, or substitute a direct schema push for the production migration path. Some migrations update or remove historical data, so review the applicable changes and take a verified backup before deployment. The supplied Compose Gateway depends on successful completion of its separate migration service.

For legacy upgrades through migration `0022`, still-pending pairing codes retain that immutable migration's normalized SHA-256 digest. The current runtime accepts only its deployment-secret-derived pairing digest, so these old pending codes cannot complete enrollment: an authorized administrator must generate a fresh pairing code after the upgrade. Do not enable an unkeyed fallback or rewrite the historical migration. Already paired agent identities and bearer-secret hashes, printer associations and print history remain preserved; the populated-legacy integration gate verifies those records separately.

The application table count excludes the migration-ledger schema and isolated test-worker schemas. Tests may create temporary schemas/databases; their results do not establish the state of a production database.

## Backup, restore and verification

[`scripts/postgres-backup.sh`](../scripts/postgres-backup.sh) and [`scripts/postgres-restore.sh`](../scripts/postgres-restore.sh) implement the repository's logical backup/restore workflow. Follow [DEPLOYMENT.md](../DEPLOYMENT.md) for protected credentials, independent backup storage, archive/checksum checks and an isolated restore target. A backup file alone is not evidence of a successful restore or a measured recovery time.

After an isolated restore, run the current migrations and application checks before admitting traffic. Preserve the restored job/claim/receipt evidence and reconcile uncertain physical outcomes; restoring database state cannot undo paper already printed.

Run the source consistency gate without a database connection:

```sh
npm run db:docs:check
```

This checks current table names against schema declarations, migration creates/drops and this document, plus the counts in `ARCHITECTURE.md`. It does not apply migrations or validate a live database, every column/index definition, tenant authorization, or backup recovery. Use the repository's PostgreSQL integration suites and deployment verification procedure for those separate checks.


## Manual subscriptions (V4)

- `subscription_requests`: verified authenticated requester identity snapshots, workspace/plan relationship, one pending request per workspace, request idempotency/digest, reviewer decision/reason/time and resulting subscription revision. Historical requester names remain blank if never recorded; never inferred from an email.
- `subscription_changes`: append-only business history of every manual subscription mutation and migration, actor, old/new values, reason, request digest and per-workspace idempotency key. Every application write also records an `audit_events` entry in the same transaction.
- `print_monthly_usage`: transactional credit consumption keyed by workspace and a fixed 30-day cycle from first activation. Separate from contract start/end and archived legacy `print_usage_periods`. Renewal and plan changes cannot reset it. Receipts and live jobs provide deduplicated logical-job reporting; migration 0101 conservatively carries consumed credits from overlapping former calendar buckets into the new cycle.

`tenant_subscriptions` stores free/paid type, optional finite monthly quota override, monthly/yearly/custom term, internal reference and revision. Migration 0098 removes the obsolete `billing_mode` column along with provider fields. New status defaults to awaiting_activation. Runtime requires explicit active status, valid start/end, unblocked entitlement and an active tenant fence. `users.display_name` is nullable for historical accounts. Retired provider columns survive only as private `legacy_billing` archive evidence.

### 0096 workspace membership access

`tenant_users.role` remains a compatibility field restricted to `admin`
and the internal `owner` marker; neither represents additional privileges.
Every enrolled person receives the fixed operational Full Access permission set,
excluding all billing, invitation, membership mutation, and platform
powers. Legacy limited membership/invitation values are converted to `admin`.
Only a separately authenticated Platform Owner may change membership or billing.
A future verified schema cutover will be required to physically drop the role field.
