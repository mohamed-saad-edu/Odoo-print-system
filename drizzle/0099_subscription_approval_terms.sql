-- Forward-only: preserve customer-request terms when the Platform Owner
-- explicitly approves a different plan, term or monthly quota.
ALTER TABLE subscription_requests
  ADD COLUMN approved_plan_id text REFERENCES plans(id),
  ADD COLUMN approved_term text,
  ADD COLUMN approved_monthly_quota integer,
  ADD COLUMN approval_modified boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE subscription_requests
  ADD CONSTRAINT subscription_requests_approved_term_check
    CHECK (approved_term IS NULL OR approved_term IN ('monthly','yearly','custom')),
  ADD CONSTRAINT subscription_requests_approved_monthly_quota_check
    CHECK (approved_monthly_quota IS NULL OR approved_monthly_quota > 0);
