-- 0101: fixed 30-day print allowance windows. Contracts remain manually renewed.
-- Anchor the allowance to first activation and never change it on plan edits.
ALTER TABLE tenant_subscriptions ADD COLUMN print_cycle_anchor timestamp;
--> statement-breakpoint
UPDATE tenant_subscriptions
SET print_cycle_anchor = current_period_start
WHERE status <> 'awaiting_activation' AND print_cycle_anchor IS NULL;
--> statement-breakpoint
-- At cutover, existing UTC calendar-month usage must not disappear simply
-- because the newly computed 30-day key differs from the old month key.
-- Historical rows are retained. A legacy row may cover time outside the new
-- interval (because exact admissions were purged by retention): conservatively
-- carry forward all overlapping consumed credits. This can only decrease
-- available credits during the first partial cycle, never grant extra prints.
WITH cycles AS (
 SELECT tenant_id, GREATEST(
   date_bin(interval '30 days', statement_timestamp() AT TIME ZONE 'UTC',
     date_trunc('milliseconds', COALESCE(print_cycle_anchor,current_period_start))),
   date_trunc('milliseconds', COALESCE(print_cycle_anchor,current_period_start))
 ) AS cycle_start
 FROM tenant_subscriptions
 WHERE status <> 'awaiting_activation' AND current_period_start <= statement_timestamp()
), carry AS (
 SELECT c.tenant_id, c.cycle_start, LEAST(2147483647, SUM(u.used_prints))::int AS consumed
 FROM cycles c JOIN print_monthly_usage u ON u.tenant_id=c.tenant_id
  AND u.period_start < c.cycle_start + interval '30 days'
  AND u.period_end > c.cycle_start
 GROUP BY c.tenant_id,c.cycle_start
)
INSERT INTO print_monthly_usage(tenant_id,period_start,period_end,used_prints)
SELECT tenant_id,cycle_start,cycle_start+interval '30 days',consumed FROM carry
ON CONFLICT (tenant_id,period_start) DO UPDATE
 SET used_prints=GREATEST(print_monthly_usage.used_prints, EXCLUDED.used_prints),
     period_end=EXCLUDED.period_end,
     updated_at=clock_timestamp();
