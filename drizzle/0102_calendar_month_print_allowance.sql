-- 0102: restore the UTC calendar-month quota; preserve historic rolling and calendar rows.
-- APPLY ONLY WITH GATEWAY ADMISSIONS DRAINED. The migration is data-only and forward-only.
-- The 0101 30-day windows and all receipts remain unchanged as audit evidence.
-- At cutover, exact month attribution can be impossible after job/receipt retention.
-- Carry the largest overlapping historical consumption (NOT the sum, which may
-- duplicate the same logical jobs in 0095 calendar and 0101 rolling ledgers).
-- This is conservative: the first partial month can overstate usage, so a
-- Platform Owner must reconcile disputes against retained job/receipt evidence.
-- Next UTC calendar month begins at zero regardless of the original activation.
WITH boundary AS (
  SELECT date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC') AS month_start
), carry AS (
  SELECT u.tenant_id, MAX(u.used_prints)::int AS already_used
  FROM print_monthly_usage u CROSS JOIN boundary b
  WHERE u.period_start < b.month_start + interval '1 month'
    AND u.period_end > b.month_start
  GROUP BY u.tenant_id
)
INSERT INTO print_monthly_usage
  (tenant_id, period_start, period_end, used_prints)
SELECT c.tenant_id, b.month_start, b.month_start + interval '1 month', c.already_used
FROM carry c CROSS JOIN boundary b
WHERE c.already_used > 0
ON CONFLICT (tenant_id, period_start) DO UPDATE SET
  used_prints = GREATEST(print_monthly_usage.used_prints, EXCLUDED.used_prints),
  period_end = EXCLUDED.period_end,
  updated_at = clock_timestamp();
