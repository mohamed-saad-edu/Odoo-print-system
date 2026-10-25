ALTER TABLE users ADD COLUMN display_name text;
-- V4 cutover preserves provider metadata and all previous usage/history.
ALTER TABLE tenant_subscriptions ADD COLUMN billing_mode text NOT NULL DEFAULT 'manual', ADD COLUMN subscription_type text NOT NULL DEFAULT 'paid', ADD COLUMN monthly_quota integer, ADD COLUMN term text NOT NULL DEFAULT 'monthly', ADD COLUMN internal_reference text, ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE tenant_subscriptions ALTER COLUMN status SET DEFAULT 'awaiting_activation';
ALTER TABLE tenant_subscriptions DROP CONSTRAINT tenant_subscriptions_status_check;
ALTER TABLE tenant_subscriptions ADD CONSTRAINT tenant_subscriptions_status_check CHECK(status IN ('awaiting_activation','active','expired','suspended','trialing','past_due','incomplete','incomplete_expired','unpaid','paused','cancelled'));
ALTER TABLE tenant_subscriptions ADD CONSTRAINT tenant_subscriptions_monthly_quota_check CHECK(monthly_quota IS NULL OR monthly_quota > 0);
ALTER TABLE tenant_subscriptions ADD CONSTRAINT tenant_subscriptions_manual_type_check CHECK(subscription_type IN ('free','paid') AND term IN ('monthly','yearly','custom') AND billing_mode = 'manual');
CREATE TABLE subscription_requests (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), requester_user_id text NOT NULL REFERENCES users(id), requester_name text NOT NULL, requester_email text NOT NULL, requester_verified_at timestamp NOT NULL,
 plan_id text NOT NULL REFERENCES plans(id), term text NOT NULL CHECK(term IN ('monthly','yearly','custom')), requested_monthly_quota integer CHECK(requested_monthly_quota IS NULL OR requested_monthly_quota > 0), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 idempotency_key text NOT NULL, request_digest text NOT NULL, last_action_by text REFERENCES users(id), last_action_at timestamp, last_action_reason text, subscription_revision integer, created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subscription_requests_key_idx ON subscription_requests(tenant_id,idempotency_key);
CREATE UNIQUE INDEX subscription_requests_pending_idx ON subscription_requests(tenant_id) WHERE status='pending';
CREATE TABLE subscription_changes (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id), actor_id text REFERENCES users(id), action text NOT NULL, idempotency_key text NOT NULL, request_digest text NOT NULL, "before" jsonb, "after" jsonb NOT NULL, reason text NOT NULL, created_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX subscription_changes_key_idx ON subscription_changes(tenant_id,idempotency_key);
CREATE INDEX subscription_changes_history_idx ON subscription_changes(tenant_id,created_at);
INSERT INTO subscription_changes (id,tenant_id,action,idempotency_key,request_digest,"before","after",reason)
SELECT 'v4-cutover-'||tenant_id,tenant_id,'legacy_migration','v4-cutover','migration',to_jsonb(s),jsonb_build_object('status',CASE WHEN status IN ('active','trialing','past_due') AND (current_period_end IS NULL OR current_period_end > now()) THEN 'active' WHEN status='paused' THEN 'suspended' ELSE 'expired' END),'V4 manual billing cutover; historical provider metadata retained; existing access only'
FROM tenant_subscriptions s;
UPDATE tenant_subscriptions SET status=CASE WHEN status IN ('active','trialing','past_due') AND (current_period_end IS NULL OR current_period_end > now()) THEN 'active' WHEN status='paused' THEN 'suspended' ELSE 'expired' END, term='custom';
CREATE TABLE print_monthly_usage (
 tenant_id text NOT NULL REFERENCES tenants(id), period_start timestamp NOT NULL, period_end timestamp NOT NULL, used_prints integer NOT NULL DEFAULT 0, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,period_start), CONSTRAINT print_monthly_usage_valid CHECK(used_prints >= 0 AND period_end > period_start)
);
-- created_at is a UTC timestamp without timezone. Receipt/live overlap counts once.
INSERT INTO print_monthly_usage(tenant_id,period_start,period_end,used_prints)
SELECT tenant_id,date_trunc('month',created_at),date_trunc('month',created_at)+interval '1 month',count(*)::integer FROM (
 SELECT id,tenant_id,created_at FROM print_jobs
 UNION ALL SELECT r.id,r.tenant_id,r.created_at FROM print_job_receipts r WHERE NOT EXISTS (SELECT 1 FROM print_jobs j WHERE j.id=r.id AND j.tenant_id=r.tenant_id)
) admissions GROUP BY tenant_id,date_trunc('month',created_at);
-- Retention may predate receipts. Preserve the full overlapping legacy allowance
-- conservatively; never grant fresh credits at cutover when exact dates are lost.
INSERT INTO print_monthly_usage(tenant_id,period_start,period_end,used_prints)
SELECT tenant_id,date_trunc('month',now() AT TIME ZONE 'UTC'),date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month',sum(used_prints)::integer FROM print_usage_periods
WHERE period_start < date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month' AND (period_end IS NULL OR period_end > date_trunc('month',now() AT TIME ZONE 'UTC')) GROUP BY tenant_id
ON CONFLICT(tenant_id,period_start) DO UPDATE SET used_prints=greatest(print_monthly_usage.used_prints,EXCLUDED.used_prints);

-- Freeze each inherited finite allowance so later catalog edits cannot silently
-- change a customer's quota; unlimited remains explicit legacy plan behavior.
UPDATE tenant_subscriptions s SET monthly_quota=(p.entitlements->>'max_prints_per_period')::integer FROM plans p WHERE p.id=s.plan_id AND p.entitlements->>'max_prints_per_period' ~ '^[0-9]{1,9}$' AND (p.entitlements->>'max_prints_per_period')::integer>0;
