import { sql, type SQL } from "drizzle-orm";

/** One allowance cycle is precisely 30 × 24 hours, independently of the contract term. */
export const QUOTA_CYCLE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * PostgreSQL is the source of time. Use one stable UTC instant per statement,
 * and truncate the origin to milliseconds: pg's timestamp carries microseconds
 * but the Node pg driver and print_monthly_usage keys round to milliseconds.
 */
export function quotaCycleStartSql(anchor: SQL, at: SQL = sql`statement_timestamp() AT TIME ZONE 'UTC'`): SQL {
  const origin = sql`date_trunc('milliseconds', ${anchor})`;
  return sql`GREATEST(
    date_bin(interval '30 days', ${at}, ${origin}),
    ${origin}
  )`;
}
