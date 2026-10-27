-- Forward-only: published catalog prices in USD cents or SAR halalas.
-- Existing plans remain unpriced until the Platform Owner sets a value.
-- No payment, invoice, quota, or subscription state is changed.
ALTER TABLE plans
  ADD COLUMN price_minor_units integer,
  ADD COLUMN price_currency text;
--> statement-breakpoint
ALTER TABLE plans
  ADD CONSTRAINT plans_price_configuration_check
  CHECK (
    (price_minor_units IS NULL AND price_currency IS NULL)
    OR (price_minor_units >= 0 AND price_currency IN ('USD','SAR'))
  );
