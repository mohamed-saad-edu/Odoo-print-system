-- V4 retired the old fake Stripe trial renewal model.
-- This operator-only legacy SQL is intentionally fail-closed.
DO $$ BEGIN RAISE EXCEPTION 'Legacy trial renewal is disabled on V4: use audited Platform Owner manual subscriptions'; END $$;
