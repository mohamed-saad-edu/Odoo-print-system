# Migration Guide

> See also: [OPERATIONS.md](./OPERATIONS.md)

## Overview

The Gateway uses **Drizzle ORM** for database migrations. All migrations are SQL files in `drizzle/` with metadata in `drizzle/meta/_journal.json`.

## Running Migrations

```bash
DATABASE_URL="postgresql://..." npm run db:migrate
```

This runs `scripts/db-migrate.ts` which applies all pending migrations from `drizzle/` in journal order.

## Migration History

| Range | Count | Description |
|-------|-------|-------------|
| 0000–0027 | 28 | Initial schema through single-tenant features |
| 0028 | 1 | Multi-tenancy migration (composite keys, tenant_id columns) |
| 0029–0039 | 11 | Post-tenancy features (billing, audit, lifecycle, rate limits) |
| 0040 | 1 | Tenant lifecycle (suspend/delete) |
| 0041 | 1 | Composite FK prerequisite fix (idempotent) |
| 0042 | 1 | Denial-of-service protection indexes |
| 0043 | 1 | Platform owner account |
| 0044 | 1 | Single platform owner uniqueness |
| 0045 | 1 | Audit events platform scope |
| 0046 | 1 | Internal print-job idempotency scope |
| 0047 | 1 | Desired printer state reconciliation |
| 0048 | 1 | Running discovery session per-agent uniqueness |
| 0049 | 1 | Tenant-scoped idempotency and owner uniqueness |
| 0050 | 1 | Billing single-flight operation state |
| 0051 | 1 | Agent lifecycle revision |
| 0052 | 1 | Plan catalog management |
| 0053 | 1 | Discovery spooler name |
| 0054 | 1 | Odoo Gateway activation state |
| 0055 | 1 | Job events and spooler job id |
| 0056 | 1 | Discovered device class NOT NULL |
| 0057 | 1 | API key composite index |
| 0058 | 1 | Scope Odoo activation to the installation API key |
| 0059 | 1 | Remove API key scope and document-type restrictions |
| 0060–0069 | 10 | Billing, usage, time authority, key rotation, job-event hardening, and claim-id redaction |
| 0070 | 1 | Durable discovered-device identity for per-Agent sync convergence |
| 0071 | 1 | Remove obsolete print-job rate-limit table |
| 0072 | 1 | Tenant-scoped printer identity and discovered devices |
| 0073 | 1 | Refresh tokens table for auth session management |
| 0074 | 1 | Token-table delete cascades and drop of the dead applications table |
| 0075 | 1 | Discovery state-machine CHECKs and drop of the redundant device-identity index |
| 0076 | 1 | Candidate provisioning discovery CHECK |
| 0077 | 1 | Durable per-Agent inventory snapshots and ordering state |
| 0078 | 1 | Hot-path query indexes for jobs, audit events, Agents, and printers |
| 0079 | 1 | Stable bounded Team member/invitation pagination indexes |
| 0080 | 1 | Inventory snapshot version tracking |
| 0081 | 1 | Physical-only printer admission; transactional removal of legacy virtual/redirected destinations and associated history |
| 0082 | 1 | Forward tracking for audit repairs, maintenance sweep index, foreign key cascade indexes, and tenant-scoped notification trigger |
| 0083 | 1 | Standalone tenant-scoped E2E capture queue for simulated PDF rendering, without physical print-job accounting |
| 0084 | 1 | Agent-owned printer cloud sharing and retained version fence, preserving canonical identities/health/lifecycle/history |
| 0085 | 1 | Additive Gateway-enrolled Odoo installation identities, immutable v2 job associations, audited historical decisions, and opt-in strict cutover; existing print keys and receipts remain untouched |
| 0086 | 1 | Agent-scoped physical printer endpoint identity, non-authorizing historical API key references and removal of deleted credential tombstones |
| 0087 | 1 | Allow multiple independent Odoo installations per API key; first registration of an empty workspace safely switches it from legacy to strict-v2 without rewriting historical receipts |
| 0088 | 1 | Retire simulated E2E capture storage without touching real print jobs; make strict-v2 the default for new workspaces |
| 0089 | 1 | Bind email-verification proofs to workspace invitations so new invitees join the company workspace without creating a second tenant |
| 0090 | 1 | Platform administrator passkeys, encrypted TOTP fallback, single-use recovery and challenges, MFA version fencing and persisted session assurance |
| 0091 | 1 | Human workspace inactivity/password proof, exact family scope and forward revocation of pre-policy refresh and legacy sessions |
| 0092 | 1 | Historical workspace factor/session cutover; superseded by 0093 without rewriting this SQL |
| 0093 | 1 | Password-only human login; remove eight retired factor tables and factor-only columns; preserve accounts, verifier hashes, memberships, session families and deadlines |
| 0094 | 1 | Add live printer verification, scoped logical identity, immutable job destination bindings, and retained PDF file-result evidence; historical inventory remains pending until verified |
| 0095 | 1 | Manual subscriptions, authenticated activation requests, immutable change history, owner names and UTC monthly admission ledger; retains provider evidence and conservatively carries prior usage |

**Total**: 96 forward-only SQL migrations (0000–0095), plus retained hash-versioned forward repairs in `scripts/db-migrate.ts`.

Apply all migrations through `0094` before starting V3, with older Gateway instances stopped. Historical `0090` and `0092` remain in the journal so existing content hashes and fresh replay remain valid. V3 uses email/password login and the existing production `__Host-` access/refresh cookies. Migration `0094` does not convert stored configuration into live printer proof: existing registrations and historical queued jobs without an admitted binding remain ineligible for new execution. Deploy the matching Agent, obtain a fresh verified inventory, and reconcile retained legacy jobs explicitly. Terminal history remains available for exact result replay. See the V3 upgrade procedure below and `SECURITY.md`.

Apply `0084` before deploying the matching Gateway and Agent/Desktop sharing feature. Existing rows default to shared; the owning Agent's newer explicit permission decides subsequent publication. Same-version denial is retained across pages/replays. Private printer/job identities are preserved, and no backfill deletes or disables Windows queues. Keep the protected local sharing file and a compatible Agent/CLI bundle during rollback; see `docs/RELEASE_GATES.md`.

**Deployment warning for 0081:** Back up PostgreSQL and drain active print jobs before running this migration. Migration 0081 removes virtual/redirected printer records and their associated historical jobs/receipts; it refuses to proceed while any affected job is claimed or printing. This is a permanent data-removal migration already present in the source, **not** introduced by the CI documentation update.

The production migrator applies every unapplied hash under one advisory lock, regardless of regressing historical timestamps. Forward repairs add retained terminal receipts, Stripe revision/checkout intent fields and price history, terminal claim hashes, and the payload null-check repair; existing SQL and repair hashes must never be rewritten.

## Migration Policy

### Never Rewrite History

- **Never delete** existing migration files
- **Never rename** migration files
- **Never reorder** migrations
- **Never modify** migration content after deployment

### Forward Migrations Only

All fixes must use **new forward migrations** with idempotent guards:

```sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE connamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND conname = 'my_constraint'
  ) THEN
    ALTER TABLE my_table ADD CONSTRAINT my_constraint ...;
  END IF;
END $$;
```

Constraint names can repeat in different schemas. New guards must check the target namespace as well as the name. The production migrator pins the canonical public search path and scopes known legacy name-only guards at execution while retaining their original content hashes.

### Statement Breakpoints

Drizzle splits SQL files on `--> statement-breakpoint` markers. Each segment is executed as a separate statement. **Missing breakpoints cause silent failures** when consecutive `DO $$ ... END $$;` blocks are concatenated into a single query.

Always add breakpoints between independent SQL statements:

```sql
DO $$ BEGIN ... END $$;
--> statement-breakpoint
DO $$ BEGIN ... END $$;
```

### Fresh Replay Requirement

Every migration must be valid when replayed from an empty database. CI verifies this on every push:

```bash
# CI step: create empty DB, replay all migrations
createdb test_db
DATABASE_URL="..." npm run db:migrate
```

## Troubleshooting

### Migration 0029: Ambiguous Legacy Ownership

This migration intentionally stops if it detects ambiguous legacy ownership (multiple agents claiming the same printer). Resolve the ownership manually, then re-run.

### Migration 0032: Duplicate Pairing Codes

This migration stops if two pending pairing codes share one hash. Disable and re-enable the affected agents to regenerate codes, then re-run.

### CI Failure: Missing Composite FK Prerequisites

**Symptom**: `ERROR 42830: there is no unique constraint matching given keys for referenced table`

**Root cause**: Missing `--> statement-breakpoint` separators between DO blocks in earlier migrations. Fixed in migration 0041 (idempotent forward migration).

## Schema Verification

CI runs a schema tripwire test that verifies the migrated database matches the Drizzle schema definition:

```bash
npm run test:integration  # includes ci-tripwire.check.ts
```

## Workspace session security cutover (0091)

Apply `0091` with all older Gateway instances drained. It creates `workspace_session_security` and revokes existing customer/manager refresh families plus legacy manager sessions; no issue timestamp is converted into password or activity proof. Users sign in again, and supported development/test environment Managers must use their actual configured password. New families enforce a thirty-minute idle timeout and five-minute confirmation for sensitive mutations, while retaining the original thirty-day absolute cap. Ordinary probes and refresh do not extend idle time.

The schema change is additive; application rollback is a security cutover, not a rolling mixed-version deployment. Stop traffic and revoke all active human workspace families before running an older application that ignores policy rows. Keep the table and migration ledger; do not delete business data or rewrite applied migration hashes. After restoring a backup, revoke restored session credentials before resuming traffic. Paired Agent credentials are separate from this human-session cutover.


## V3 password-only authentication upgrade (0093)

`0090` and `0092` are immutable historical migrations. Their factor behavior is retired by `0093_password_only_authentication`; they are not a supported optional V3 configuration. The new migration removes exactly eight factor-only tables, their constraints/indexes, the two account factor-version columns and the factor-only session columns. It preserves both session-security tables, users, salted password hashes, email-verification state, owner flags, memberships/roles, all refresh rows and their replacement/revocation history. No customer, tenant, job, printer or audit row is deleted by `0093`.

The new `platform_session_security.password_version` is populated from SHA-256 of the account's existing salted password verifier using PostgreSQL core functions, then made NOT NULL with a 64-hex-character constraint. This binds a retained policy to its current credential without needing application signing-key material during migration. Existing password-verification, idle, absolute-expiry and revocation timestamps are unchanged; expired/revoked sessions remain expired/revoked. Workspace HMAC credential proofs are retained byte-for-byte. This backfill establishes credential binding for previously valid sessions; it does not claim that another password ceremony occurred at upgrade time.

### Concrete rollout

1. Take and verify a protected PostgreSQL backup and retain the matching application revision and existing signing-key custody. Test restoration into a separate isolated database before the production change. Old backups can still contain retired factor data and must retain their prior protection/retention classification.
2. Stop request admission and drain every Gateway instance, worker and maintenance process using the database. Do not run V2 and V3 against the migrating schema together.
3. Record counts and protected comparison hashes for `users`, `tenant_users`, `refresh_tokens`, both session-policy tables, legacy session rows and the migration ledger. Include password-hash identity and all deadline/revocation fields in the comparison without printing secrets.
4. Run `npm run db:migrate` with the migration-owner role. The production runner applies the new migration and ledger entry in one locked transaction. No `CASCADE` is used; an unexpected dependent view/foreign key aborts everything. Resolve a real dependency deliberately before retrying; do not add a cascading drop to force completion.
5. Verify all prior ledger hashes and preserved records; the only session addition is the platform credential fingerprint. Verify the eight retired factor stores/columns are absent and both password-session policies remain. Run the selected login, idle/absolute expiry, refresh/logout, reauthentication, tenant isolation and reset/invitation gates on the migrated isolated deployment.
6. Start only V3 instances and admit traffic after those checks. Existing valid V2 session families with durable policy retain their original deadlines. Legacy/pre-policy sessions, expired tokens and revoked families do not acquire new authority. Pending restricted V2 authentication attempts restart at ordinary password login.

The populated-upgrade regression `tests/password-auth-migration.integration.test.ts` runs the exact V2 migration prefix, seeds every retired store plus account/session history, verifies an unexpected dependency causes a complete rollback, then compares every preserved table and ledger row after the successful upgrade. It also checks current session-policy admission and idempotent migration replay. These local results do not substitute for the deployment's own backup and comparison evidence.

### Rollback boundary

Do not start V2 against the V3 schema: its removed tables and columns no longer exist. Prefer a reviewed forward fix. If an application rollback is required, keep traffic stopped and restore the matching pre-upgrade database and application revision together into an explicitly selected target; retain any external secret material required by that older revision. Reconcile newer business/print evidence before switching, because restoration cannot undo physical paper output. Revoke restored human-session credentials before traffic resumes if their revocation history could have rolled back. Never delete ledger rows, rewrite historical SQL or re-create empty factor tables to pretend that old authentication state survived.

## Email verification and recovery proof deadlines

This release caps registration, resend and invitation-onboarding email proofs, password-reset links and the mailbox-owner password-setup continuation at ten minutes. All five issuers stamp creation and expiry from PostgreSQL time after preceding lock waits. Both consumers enforce the original creation-time cap at lookup and atomic consumption, even when an older outstanding row has a twenty- or thirty-minute stored expiry. Future creation timestamps fail closed, and a shorter stored expiry still takes precedence. No schema or historical migration rewrite is needed, and no existing issue time is backfilled.

Drain older Gateway instances during this policy cutover so they cannot continue accepting the former longer deadlines. An expired verification proof can be replaced through the existing resend flow; expired reset and setup pages now link explicitly to `/forgot-password`. Requesting a new link remains a deliberate user action and does not replay a password change. SMTP delay or an old email's longer expiry wording cannot extend the stored proof's authority. The invitation offer's own business deadline, paired-Agent/service credentials and human session lifetimes are unchanged; an invitation still requires separate mailbox or current-session proof before joining a workspace.


## V4 manual subscription cutover

0095 preserves all historical Stripe columns, receipts, job identities and prior `print_usage_periods`. It records a `subscription_changes` before/after snapshot per existing subscription. Only previously usable active/trialing/past_due records with an unexpired or open-ended contract retain active access; paused becomes suspended and all other legacy statuses become expired. New subscriptions default to awaiting activation. Finite inherited quotas are frozen as workspace overrides.

`print_monthly_usage` is a new UTC calendar-month admission ledger. Receipt/live overlap is deduplicated by persistent logical job ID. For the cutover month, an overlapping legacy usage allowance is conservatively retained when it exceeds reconstructed evidence. This may overcount a prior non-calendar allowance, but never grants fresh midmonth credits. An owner may review evidence and increase the monthly quota; historical counters are never reset. Do not delete old usage records.

Every annual or custom contract uses monthly credits. Renewals and quota changes retain the existing monthly ledger. Accepted jobs consume one credit even if canceled/failed/uncertain; rejection before admission and idempotent replay consume none. Provider endpoints now return 410 and never mutate subscription state. Catalog bootstrap uses `YASEIR_PLAN_CATALOG`, with no payment provider configuration.
