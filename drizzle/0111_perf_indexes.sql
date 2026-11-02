-- 0111: performance indexes (v6-perf, evidence-based; see PERF.md).
-- G1: print_job_receipts (tenant_id, created_at, id) — HQ2 history
--   branch + HQ3 tenant usage. Receipts previously had NO tenant/created index;
--   baseline EXPLAIN on 100k seeded receipts: Parallel Seq Scan + sort, 33.8ms.
-- G2: print_job_receipts (created_at) — HQ7 24h hourly chart + HQ3 platform-wide
--   usage (no tenant filter, so G1 cannot serve them); baseline: Seq Scan 17.9ms.
-- G4: discovery_sessions (tenant_id, agent_id, created_at) — HQ6 history
--   list (limit 20); small table, trivial build.
-- G5: subscription_requests (tenant_id, created_at) — HQ7 billing list
--   (limit 50) + latest-request read; small table, trivial build.
-- NOT added (deliberate, see PERF.md): print_jobs (agent_id, status, created_at)
--   — baseline EXPLAIN on 50k seeded jobs already serves the claim shape at
--   ~0.1ms via print_jobs_created_at_idx; adding it would duplicate the
--   (agent_id, status) prefix for an unproven gain plus write amplification
--   on the hottest write path.
-- DEPLOY NOTE: this project's migrator (scripts/db-migrate.ts) runs migrations
-- inside a single transaction, so CREATE INDEX CONCURRENTLY cannot be used
-- through it. These CREATE INDEX statements take a brief ACCESS EXCLUSIVE lock
-- per table for the duration of the build. On very large receipts tables,
-- apply G1/G2 out-of-band with CONCURRENTLY first (in a maintenance window),
-- then let this migration run with IF NOT EXISTS (no-op for already-built
-- indexes). Do NOT edit migrations 0000-0110.
CREATE INDEX IF NOT EXISTS print_job_receipts_tenant_created_idx ON print_job_receipts USING btree (tenant_id, created_at, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS print_job_receipts_created_at_idx ON print_job_receipts USING btree (created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS discovery_sessions_tenant_agent_created_idx ON discovery_sessions USING btree (tenant_id, agent_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS subscription_requests_tenant_created_idx ON subscription_requests USING btree (tenant_id, created_at);
