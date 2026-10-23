# Gateway database reference

The Gateway uses PostgreSQL through the shared `pg` pool and Drizzle definitions in [`src/db/index.ts`](../src/db/index.ts) and [`src/db/schema.ts`](../src/db/schema.ts). This document describes the checked-in schema and migration process. It is not evidence that a deployment was migrated, backed up, restored, or tested successfully.

## Schema inventory

There are **30 current application tables**, **86 forward-only SQL migrations (`0000`–`0085`)**, and additional versioned forward repairs in [`scripts/db-migrate.ts`](../scripts/db-migrate.ts). The inventory checker finds 37 created table names and 7 subsequently dropped legacy names. The migration ledger, `drizzle.__drizzle_migrations`, is separate from the 30 application tables.

| Table | Purpose and identity | Scope and relevant constraints |
| --- | --- | --- |
| `tenants` | Workspace identity, name, lifecycle and lifecycle timestamps | Primary key `id`; lifecycle is `active`, `suspended`, or `deleted` |
| `tenant_domains` | Workspace domain bindings and verification metadata | Tenant reference; globally unique domain; verification is explicit |
| `users` | Global account identity, password hash, email verification and Platform Owner flag | Globally unique email; partial unique index permits at most one Platform Owner |
| `tenant_users` | Membership and current role for a user in a workspace | Unique `(user_id, tenant_id)` identity and at most one owner per tenant; role CHECK; no formal primary key |
| `platform_sessions` | Compatibility validation/revocation of pre-v2 Platform sessions | JTI primary key, user reference, expiry and revocation; current application issuance uses v2 refresh families |
| `manager_sessions` | Compatibility validation/revocation of pre-v2 workspace sessions | JTI primary key, tenant, optional user, role, expiry and revocation; not the current v2 access-token ledger |
| `refresh_tokens` | Hashed opaque v2 refresh credentials, family history and replacement/revocation evidence | Unique token hash; family/user/tenant indexes; kind/scope and time-order CHECKs; replacement self-reference |
| `email_verification_tokens` | Single-use mailbox verification credential hashes | User reference, unique token hash, expiry and consumed timestamp |
| `password_reset_tokens` | Password reset/setup credential hashes | User reference, unique token hash, expiry and consumed timestamp |
| `tenant_invitations` | Pending/accepted/revoked workspace invitations | Tenant and inviter references, unique token hash, expiry, bounded member role set excluding owner |
| `agents` | Paired Agent identity, hashed bearer secret, pairing-code hash/expiry, lifecycle and inventory snapshot progress | Tenant reference and unique `(tenant_id, id)`; global uniqueness for pending pairing-code hashes; separate runtime status and lifecycle |
| `printers` | Printer configuration, capability metadata, desired/applied revisions, inventory presence and local sharing permission | Tenant-scoped `(tenant_id, id)` UNIQUE identity, not a global ID primary key; composite tenant/Agent FK; revision and sharing-version CHECKs |
| `api_keys` | Integration credential hashes, revocation/read-only grace and Odoo activation revision | Tenant reference, unique credential hash and `(tenant_id, id)`; read-only grace requires revocation |
| `odoo_installations` | Operator-enrolled Gateway identity for each independently managed Odoo deployment; proof hash, state and lifecycle | Unique tenant/installation ID; proof never stored in job/audit rows |
| `odoo_installation_credentials` | Preserved credential-to-installation ownership, including key rotations | Unique `(tenant_id, api_key_id)` and tenant/installation composite foreign key |
| `odoo_v2_operations` | Lifetime association of versioned Odoo business identity to original accepted Gateway job | Per-installation operation composite primary key, tenant-wide versioned-key unique constraint; no physical retry implied |
| `odoo_legacy_resolutions` | Explicit, audited operator decisions about old-key collisions | Tenant/installation uniqueness, immutable observed job fingerprint and decision (`reuse` or `distinct`) |
| `discovery_sessions` | Agent discovery run state, requested scan configuration and chunk/summary evidence | Composite tenant/Agent FK; at most one `running` session per tenant/Agent |
| `discovered_devices` | Tenant-scoped observations, candidate identity, verification and optional provisioned-printer link | Composite tenant/discovery, tenant/Agent and tenant/printer FKs; unique non-null `(tenant_id, agent_id, identity_key)` |
| `print_jobs` | Admitted print payload, destination, state, claim/attempt fencing and delivery/acknowledgment timestamps | Composite tenant/Agent, tenant/printer and tenant/API-key FKs; unique non-null `(tenant_id, idempotency_key)`; payload/status/counter CHECKs |
| `job_events` | Per-job timeline and attempt/correlation metadata | Composite tenant/job FK with cascade on job deletion; bounded stage/status sets |
| `print_job_receipts` | Payload-free terminal receipt and idempotency evidence retained after job-history cleanup | Tenant reference, unique `(tenant_id, idempotency_key)`, fingerprint and terminal outcome; retained historical resource IDs are not all live FKs |
| `gateway_metrics` | Shared operational counters | Global metric-name primary key; nonnegative value; written by the metrics service |
| `audit_events` | Actor/action/resource audit metadata | Tenant is required except for Platform actor records; actor type CHECK and scope/time indexes |
| `auth_rate_limits` | Authentication attempt windows, failure counters and lockout expiry | Global opaque-key primary key; account/source-IP/pairing scope is encoded by the application, not a tenant column |
| `plans` | Public/private plan catalog, entitlements and current/historical Stripe price identity | Global plan identity/name; optional Stripe price/product uniqueness; active/public/display-order fields |
| `tenant_subscriptions` | Tenant plan and provider billing state, checkout intent/session and billing-operation reconciliation | One row per tenant; plan references; unique provider/idempotency identities; bounded subscription/checkout/operation states |
| `billing_events` | Provider webhook receipt, payload and processing state | Provider event ID primary key for deduplication; optional tenant reference until the event is associated |
| `print_usage_periods` | Reserved/used print credits per billing period | Composite primary key `(tenant_id, period_start)`; nonnegative use and ordered optional period end |
| `e2e_capture_runs` | Opt-in render-only diagnostic queue independent of physical print jobs and billing | Composite tenant/Agent FK; tenant/API-key/idempotency uniqueness; bounded attempts/pages/size; terminal rows clear the submitted payload but may retain a preview |

The schema retains global account, catalog, metric and authentication data alongside tenant-scoped data. A missing `tenant_id` on a global table is not by itself an isolation defect. Conversely, the existence of a tenant column does not authorize access to a row.

## Isolation and state invariants

Isolation is enforced by authenticated tenant context, permission checks, ownership predicates and transactional revalidation in the Gateway. The supplied migrations do not enable PostgreSQL row-level security. Composite foreign keys add database enforcement where declared; they do not replace current-actor or tenant-lifecycle checks.

In particular, printer and discovered-device IDs are unique within a tenant. Agent-generated IDs can legitimately repeat in different tenants. Queries and references must use the full tenant-scoped identity. The capture queue's API-key FK references the key by ID; its admission service additionally verifies that the active key and Agent belong to the authenticated tenant before insertion (`src/lib/e2e-capture.ts`).

Keep printer lifecycle, observed health, inventory presence, sharing permission and physical print outcome separate. The database's physical-printer filters reject known virtual/redirected metadata patterns; they are not hardware attestation. An accepted or acknowledged print job is not universal proof of paper output. Claim tokens and terminal receipts support reconciliation; do not reset an uncertain job to `queued` by hand. See [OPERATIONS.md](../OPERATIONS.md).

`print_jobs_payload_contract_check` uses `COALESCE` to reject missing type/protocol discriminators on new or updated rows. Migration `0082` and its retained forward repair add this CHECK as **NOT VALID**: existing historical rows are not validated by that step. This must not be presented as proof that every old payload is valid. Application payload validation remains necessary.

`users_single_platform_owner_idx` and the tenant-owner partial unique index impose **at most one** owner at their respective scopes. They do not create an owner or guarantee that one exists. Account/bootstrap and ownership-transfer transactions enforce those workflows.

## Authentication and sensitive data

Current browser access JWTs are short-lived and are not stored as refresh-token rows. The `refresh_tokens` table holds hashes of opaque refresh secrets, family history and revocation evidence. Validation also checks the live principal and current membership. Legacy session tables remain for pre-v2 compatibility and revocation. See [SECURITY.md](../SECURITY.md) for cookie, rotation and expiry behavior.

Agent and API-key columns contain credential hashes, not recoverable raw bearer secrets. Passwords use the account password-hashing implementation. Pairing codes use the deployment's configured keyed hashing policy. A database backup still contains sensitive data: credential hashes, account identifiers, print payloads, billing webhook payloads, capture previews and operational metadata. Restrict database/backup access and apply deployment encryption and retention controls; the schema does not encrypt all of those columns.

Audit rows are persisted in PostgreSQL, but not every audit write is atomic with its business operation. Some paths write best effort after commit. The audit table is not an external alert-delivery service or an immutable storage boundary against a privileged database account.

## Connection and transaction behavior

The runtime accepts `DATABASE_URL` or structured `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` and password settings through the secret-loading implementation. The supplied Compose stack reads its database password from a mounted secret file. Never put real connection credentials in this reference or command logs.

The shared pool uses UTC sessions and UTC serialization for JavaScript dates. Most schema timestamps are timezone-naive and interpreted as UTC; `job_events.created_at` and `gateway_metrics.updated_at` are explicitly timezone-aware. Do not change session timezone or reinterpret historical naive values as local wall-clock times.

Current pool defaults are 20 connections, a 10-second connection timeout, 30-second idle/statement timeouts, a 5-second lock timeout and recycling after 10,000 uses. These are implementation settings, not throughput guarantees. Cross-instance claim/admission coordination uses PostgreSQL transactions, row/advisory locks and fenced state changes in the relevant services; process-local state alone is not the authority.

The shipped Compose migration and runtime services use the same configured PostgreSQL principal. A separate reduced-privilege runtime role is not provisioned by that configuration. Deployments that separate migration/runtime privileges must provide and validate the grants for their environment.

## Applying migrations

With the intended database connection configured, the application command is:

```sh
npm run db:migrate
```

`scripts/db-migrate.ts` reads the Drizzle journal, begins a transaction, fixes the target `search_path` to `public`, and takes a database/schema-scoped transaction advisory lock. It checks recorded content hashes in `drizzle.__drizzle_migrations`, applies missing journal entries in order, then applies missing hash-addressed `AUDIT_REPAIRS`. Success commits; a failure rolls back the transaction.

Append new migrations or versioned forward repairs. Do not edit historical SQL/hash identities, delete migration-ledger rows to force replay, or substitute a direct schema push for the production migration path. Some migrations update or remove historical data, so review the applicable changes and take a verified backup before deployment. The supplied Compose Gateway depends on successful completion of its separate migration service.

The application table count excludes the migration-ledger schema and isolated test-worker schemas. Tests may create temporary schemas/databases; their results do not establish the state of a production database.

## Backup, restore and verification

[`scripts/postgres-backup.sh`](../scripts/postgres-backup.sh) and [`scripts/postgres-restore.sh`](../scripts/postgres-restore.sh) implement the repository's logical backup/restore workflow. Follow [DEPLOYMENT.md](../DEPLOYMENT.md) for protected credentials, independent backup storage, archive/checksum checks and an isolated restore target. A backup file alone is not evidence of a successful restore or a measured recovery time.

After an isolated restore, run the current migrations and application checks before admitting traffic. Preserve the restored job/claim/receipt evidence and reconcile uncertain physical outcomes; restoring database state cannot undo paper already printed.

Run the source consistency gate without a database connection:

```sh
npm run db:docs:check
```

This checks current table names against schema declarations, migration creates/drops and this document, plus the counts in `ARCHITECTURE.md`. It does not apply migrations or validate a live database, every column/index definition, tenant authorization, or backup recovery. Use the repository's PostgreSQL integration suites and deployment verification procedure for those separate checks.
