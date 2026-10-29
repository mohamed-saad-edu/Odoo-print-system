import { sql } from "drizzle-orm";
import { db, type DbTx } from "../db";
/** Logical admissions are persistent job IDs, never status rows or page counts.
 * A receipt may overlap its live row during retention; exclude that overlap.
 * History shows only exact UTC calendar-month buckets: 0101 rolling buckets
 * remain stored as evidence but must not appear as duplicate calendar months. */
export async function logicalUsageReport(tenantId: string|null=null, tx?: DbTx) {
 const resultQuery=sql`
 WITH admissions AS (
  SELECT id,tenant_id,created_at FROM print_jobs WHERE (${tenantId}::text IS NULL OR tenant_id=${tenantId})
  UNION ALL
  SELECT r.id,r.tenant_id,r.created_at FROM print_job_receipts r WHERE (${tenantId}::text IS NULL OR r.tenant_id=${tenantId}) AND NOT EXISTS(SELECT 1 FROM print_jobs j WHERE j.id=r.id AND j.tenant_id=r.tenant_id)
 ), boundaries AS (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now)
 SELECT count(*) FILTER(WHERE created_at>=date_trunc('day',boundaries.now))::int AS today,
 count(*) FILTER(WHERE created_at>=date_trunc('month',boundaries.now))::int AS month,
 count(*) FILTER(WHERE created_at>=date_trunc('year',boundaries.now))::int AS year
 FROM admissions CROSS JOIN boundaries WHERE created_at<=boundaries.now
 `;
 const result=tx ? await tx.execute(resultQuery) : await db.execute(resultQuery);
 const historyQuery=sql`SELECT period_start AS "periodStart",sum(used_prints)::bigint AS used FROM print_monthly_usage WHERE (${tenantId}::text IS NULL OR tenant_id=${tenantId}) AND period_start>=date_trunc('year',clock_timestamp() AT TIME ZONE 'UTC')-interval '1 year' AND period_start=date_trunc('month',period_start) AND period_end=period_start+interval '1 month' GROUP BY period_start ORDER BY period_start DESC LIMIT 24`;
 const history=tx ? await tx.execute(historyQuery) : await db.execute(historyQuery);
 return {...result.rows[0],monthlyHistory:history.rows,timezone:'UTC',unit:'accepted_logical_job',source:'live jobs plus durable receipts, deduplicated by tenant and job ID',quotaSource:'transactional UTC calendar-month admission ledger; cutover 0102 carries the largest overlapping bucket and retains historical rolling rows'};
}
