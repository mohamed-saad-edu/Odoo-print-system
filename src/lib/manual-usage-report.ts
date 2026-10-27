import { sql } from "drizzle-orm";
import { db } from "../db";
/** Logical admissions are persistent job IDs, never status rows or page counts.
 * A receipt may overlap its live row during retention; exclude that overlap. */
export async function logicalUsageReport(tenantId: string|null=null) {
 const result=await db.execute(sql`
 WITH admissions AS (
  SELECT id,tenant_id,created_at FROM print_jobs WHERE (${tenantId}::text IS NULL OR tenant_id=${tenantId})
  UNION ALL
  SELECT r.id,r.tenant_id,r.created_at FROM print_job_receipts r WHERE (${tenantId}::text IS NULL OR r.tenant_id=${tenantId}) AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.id=r.id AND j.tenant_id=r.tenant_id)
 ), boundaries AS (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now)
 SELECT count(*) FILTER(WHERE created_at>=date_trunc('day',boundaries.now))::int AS today,
 count(*) FILTER(WHERE created_at>=date_trunc('month',boundaries.now))::int AS month,
 count(*) FILTER(WHERE created_at>=date_trunc('year',boundaries.now))::int AS year
 FROM admissions CROSS JOIN boundaries WHERE created_at<=boundaries.now
 `);
 const history=await db.execute(sql`SELECT period_start AS "periodStart",sum(used_prints)::bigint AS used FROM print_monthly_usage WHERE (${tenantId}::text IS NULL OR tenant_id=${tenantId}) AND period_start>=date_trunc('year',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 year' GROUP BY period_start ORDER BY period_start DESC LIMIT 24`);
 return {...result.rows[0],monthlyHistory:history.rows,timezone:'UTC',unit:'accepted_logical_job',source:'live jobs plus durable receipts, deduplicated by tenant and job ID',quotaSource:'transactional fixed 30-day admission ledger anchored at activation; legacy cutover conservatively preserves overlapping allowance'};
}
