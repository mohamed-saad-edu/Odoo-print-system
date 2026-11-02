# Database triggers and functions (v3 inventory)

Drizzle `src/db/schema.ts` and the migration snapshots capture tables, not
triggers or functions. The following exist only in SQL; a future `db:push`
or schema-diff workflow that is unaware of them could silently drop or
misreport enforcement. Keep this inventory in sync when adding triggers.

| Object | Defined in | Purpose |
|---|---|---|
| API-key tenant guard trigger + function | `drizzle/0086_printer_identity_and_api_key_deletion.sql:22-35` | Replaces the dropped job -> api_key FK (0086:3); enforces tenant-scoped API-key references on job writes. |
| Notify trigger + function (single surviving definition) | `drizzle/0017_notify_requeued_jobs.sql:1-17` (supersedes `drizzle/0015_metrics_and_agent_notifications.sql:7-21`) | `print_jobs_notify_agent_job_available` (AFTER INSERT OR UPDATE OF status): notifies `print_gateway_agent_jobs` on INSERT and on any transition INTO `queued` (NEW.status='queued' AND OLD IS DISTINCT FROM NEW). 0015 and 0017 define the SAME function/trigger names, so exactly one trigger exists at any migrated state — 0017's definition wins; there are not two coexisting notify triggers. |
| `gateway_metrics` table | `drizzle/0015_metrics_and_agent_notifications.sql:1` | Metrics table created by 0015 (not a trigger); retained alongside the superseded 0015 trigger definition. |

Note: the 0086 trigger is load-bearing for the API-key deletion contract
(`src/lib/api-key-deletion.ts`): deleting a key must not orphan job rows
outside its tenant. Do not drop these triggers without a replacement
constraint, and never assume `schema.ts` alone describes enforcement.
