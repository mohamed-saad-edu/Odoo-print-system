-- PROVIDER_BILLING_RETIREMENT_V1
-- Forward-only, manual-only billing cutover. Never rewrite applied migrations.
-- Archive provider evidence separately from the operational public schema.
CREATE SCHEMA IF NOT EXISTS legacy_billing;
--> statement-breakpoint
REVOKE ALL ON SCHEMA legacy_billing FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS legacy_billing.plan_provider_history (
  plan_id text PRIMARY KEY,
  provider_metadata jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS legacy_billing.subscription_provider_history (
  tenant_id text PRIMARY KEY,
  provider_metadata jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
INSERT INTO legacy_billing.plan_provider_history (plan_id,provider_metadata)
SELECT id,jsonb_strip_nulls(jsonb_build_object(
  'stripe_price_id',stripe_price_id,
  'stripe_price_history',stripe_price_history,
  'stripe_product_id',stripe_product_id
)) FROM plans
WHERE stripe_price_id IS NOT NULL OR stripe_product_id IS NOT NULL OR cardinality(stripe_price_history) > 0
ON CONFLICT(plan_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO legacy_billing.subscription_provider_history (tenant_id,provider_metadata)
SELECT tenant_id,jsonb_strip_nulls(jsonb_build_object(
  'stripe_customer_id',stripe_customer_id,
  'stripe_subscription_id',stripe_subscription_id,
  'stripe_last_event_created_at',stripe_last_event_created_at,
  'stripe_state_revision',stripe_state_revision,
  'checkout_status',checkout_status,
  'checkout_session_id',checkout_session_id,
  'checkout_session_url',checkout_session_url,
  'checkout_idempotency_key',checkout_idempotency_key,
  'checkout_request_params',checkout_request_params,
  'billing_operation_id',billing_operation_id,
  'billing_operation_subscription_id',billing_operation_subscription_id
)) FROM tenant_subscriptions
WHERE stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL
   OR checkout_session_id IS NOT NULL OR billing_operation_id IS NOT NULL
ON CONFLICT(tenant_id) DO NOTHING;
--> statement-breakpoint
-- Provider-created subscriptions are not equivalent to Platform Owner approval.
-- Preserve any explicit manual save/renew, and fail closed on historical only.
UPDATE tenant_subscriptions s SET
  status='awaiting_activation',
  entitlement_blocked=true,
  entitlement_blocked_reason='manual_review_required'
WHERE s.status='active'
  AND (s.stripe_customer_id IS NOT NULL OR s.stripe_subscription_id IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM subscription_changes c
    WHERE c.tenant_id=s.tenant_id AND c.action IN ('save','renew')
  );
--> statement-breakpoint
UPDATE tenant_subscriptions SET
  status='suspended',
  entitlement_blocked=true,
  entitlement_blocked_reason='manual_review_required'
WHERE status NOT IN ('awaiting_activation','active','expired','suspended')
   OR billing_mode <> 'manual';
--> statement-breakpoint
UPDATE tenant_subscriptions SET entitlement_blocked_reason='manual_review_required'
WHERE entitlement_blocked_reason LIKE 'stripe_%';
--> statement-breakpoint
ALTER TABLE tenant_subscriptions
  DROP CONSTRAINT IF EXISTS tenant_subscriptions_status_check,
  DROP CONSTRAINT IF EXISTS tenant_subscriptions_manual_type_check,
  DROP CONSTRAINT IF EXISTS tenant_subscriptions_checkout_status_check,
  DROP CONSTRAINT IF EXISTS tenant_subscriptions_billing_operation_type_check;
--> statement-breakpoint
ALTER TABLE plans
  DROP COLUMN IF EXISTS stripe_price_id,
  DROP COLUMN IF EXISTS stripe_price_history,
  DROP COLUMN IF EXISTS stripe_product_id,
  DROP COLUMN IF EXISTS currency,
  DROP COLUMN IF EXISTS interval;
--> statement-breakpoint
ALTER TABLE tenant_subscriptions
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id,
  DROP COLUMN IF EXISTS billing_mode,
  DROP COLUMN IF EXISTS trial_started_at,
  DROP COLUMN IF EXISTS stripe_last_event_created_at,
  DROP COLUMN IF EXISTS stripe_state_revision,
  DROP COLUMN IF EXISTS checkout_status,
  DROP COLUMN IF EXISTS checkout_plan_id,
  DROP COLUMN IF EXISTS checkout_idempotency_key,
  DROP COLUMN IF EXISTS checkout_request_params,
  DROP COLUMN IF EXISTS checkout_intent_created_at,
  DROP COLUMN IF EXISTS checkout_session_id,
  DROP COLUMN IF EXISTS checkout_session_url,
  DROP COLUMN IF EXISTS checkout_session_expires_at,
  DROP COLUMN IF EXISTS billing_operation_id,
  DROP COLUMN IF EXISTS billing_operation_type,
  DROP COLUMN IF EXISTS billing_operation_idempotency_key,
  DROP COLUMN IF EXISTS billing_operation_subscription_id;
--> statement-breakpoint
ALTER TABLE tenant_subscriptions
  ADD CONSTRAINT tenant_subscriptions_status_check CHECK(status IN ('awaiting_activation','active','expired','suspended')),
  ADD CONSTRAINT tenant_subscriptions_manual_type_check CHECK(
    subscription_type IN ('free','paid') AND term IN ('monthly','yearly','custom')
  );
--> statement-breakpoint
-- Preserve immutable historical event/usage evidence outside runtime tables.
ALTER TABLE public.billing_events SET SCHEMA legacy_billing;
--> statement-breakpoint
ALTER TABLE public.print_usage_periods SET SCHEMA legacy_billing;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA legacy_billing FROM PUBLIC;
