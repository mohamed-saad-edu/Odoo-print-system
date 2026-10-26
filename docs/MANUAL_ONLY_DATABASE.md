# Yaseir — manual-only billing schema

The production source of truth is **Platform Owner approval**, not a payment
provider callback. Billing operations, Stripe credentials, checkout mutations
and provider price identities are not part of the active schema.

## Migration policy

Historical SQL migrations 0000–0097 and their recorded hashes must remain
immutable: changing or squashing an applied journal risks replaying incompatible
DDL on existing customer databases. Forward migration
`0098_manual_only_billing.sql` implements the one-time change.

The final public schema retains business fields only:
- `plans`: identity, description, monthly quota entitlements, catalog visibility
  and display order, timestamps.
- `tenant_subscriptions`: workspace, plan, free/paid type, term, dates,
  monthly quota, status, manual reference, revision, suspension controls and
  timestamps.
- `subscription_changes`, `subscription_requests`, `print_monthly_usage`:
  auditable actions, approval intent and durable UTC calendar credits.

The migration archives provider plan and subscription metadata, historic
provider events and old period usage into a **non-public**
`legacy_billing` schema. Operational roles must not query the archive. No
operator UI, customer API or runtime authorization path uses this schema.

Previously unapproved subscriptions carrying provider identities move to
`awaiting_activation` with a manual-review block. Owner-approved changes
(`save` or `renew`) and manual monthly usage remain unchanged.

## Release procedure

Back up the database and test restoration before migrating. Apply the normal
`npm run db:migrate` **once** as the migration owner before starting Gateway;
never run migration DDL on an active web process. Verify the migration journal
hashes, inspect `information_schema.columns` for obsolete fields and test
the four manual states. Then run fresh-database and historical-upgrade CI
suites. Do not delete the `legacy_billing` archive until a separate
approved retention policy permits it.

Old repair hash identities remain recorded. The migrator skips four provider
repair statements when the forward-only retirement migration is present,
preventing them from re-creating deleted columns on fresh installations.

The archived migration chain is intentionally retained rather than rewritten.
A full baseline squash is a separate versioned deployment operation requiring
verified restore and migration-ledger compatibility, not a text cleanup.
