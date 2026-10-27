# Yaseir — Cloud Printing Platform

Silent Odoo enterprise printing through Yaseir Gateway, Yaseir Agent, and Yaseir Print Manager.

```text
Odoo ERP
  -> Yaseir Gateway (HTTPS / WSS)
  -> Central Print Router
  -> Yaseir Agent / Yaseir Print Manager
  -> Physical Hardware Printers
```

## Ownership

Odoo owns companies/branches, business records, POS configuration, report context, and print intent.
The addon stores only Gateway connection settings, native Odoo print bindings, and a durable print outbox.
Gateway owns agents, heartbeats, runtime printers, queueing, delivery, and execution state.

The addon does not create or synchronize branches, agents, printers, destinations, or document types.

## Odoo configuration

Normal operation requires only Gateway URL, API Key, Test Connection, and Gateway Printing Enabled.

The primary binding is `Destination + Document Type -> Printer`.
The destination is an existing Odoo object such as POS configuration, warehouse operation type, report action, or company context. The printer id is a Gateway runtime identity and is never provisioned by the addon.

## Printing

Backend reports use `print_gateway.print_router` from the `ir.actions.report.report_action()` integration hook.
POS printing uses the Odoo 19 `PosStore.printReceipt()` hook, covering receipt print, POS reprint, and Restaurant Print Bill paths.

When Gateway printing is enabled, printing is silent: no browser print dialog, PDF navigation, `window.print()`, or native fallback is allowed. Failures are surfaced to the user.

When Gateway printing is disabled, the native Odoo print path is preserved.

## Reliability

Each logical print operation creates one durable Odoo outbox row and one idempotency key before external submission. Retries reuse that key. Gateway-side idempotency prevents transport retries from creating a second logical print job.

A transport interruption is represented as an unknown physical outcome until Gateway status reconciliation establishes the result.

## Gateway API key

Managers can generate an Odoo API key, copy the raw value once, and revoke it. Gateway stores only the cryptographic hash and never returns raw secrets from list/read endpoints.

## Platform plans and manual subscriptions

The platform owner manages plans at `/platform/plans` and reviews traceable activation requests at `/platform/subscription-requests`. Public plans expose a monthly logical print-job allowance. Commercial computer, printer and user counts are unlimited; request size, discovery, queue, rate and concurrency safeguards remain enforced separately.

A new workspace starts pending. Its authenticated Workspace Owner can view the current contract at `/billing` and submit an idempotent plan-change or activation request at `/api/subscription-requests`; other workspace members cannot request or inspect private commercial terms. The Platform Owner reviews requests in `/platform/subscription-requests` and, after external business settlement or an explicit free grant, confirms the dated manual subscription with recent password proof, a reason, a stale-record fence and immutable before/after history. A customer request cannot activate printing; signup and provider callbacks do not activate a workspace.

Print credits renew at 00:00 UTC on the first day of every calendar month, independently of the manual contract term. A yearly term does not provide a year-long quota bucket, and editing or renewing a subscription does not reset current-cycle usage. Accepted duplicate logical requests are counted once. Expired, pending, canceled, suspended or blocked workspaces cannot admit new print jobs; historical records and uncertain-output evidence are retained.

Plans have active/public catalog flags and no provider price requirement. Use `YASEIR_PLAN_CATALOG` with `npm run db:provision-plans` for an optional initial catalog; existing managed plans are preserved. The legacy checkout, portal, webhook, cancel and resume endpoints return HTTP 410 and perform no payment or subscription mutation. Retained provider metadata is historical evidence. An operator must separately reconcile any external recurring charges when migrating a real deployment.

## Account activation

Registration collects name and email only, stores a random provisional credential, and sends a verification link without revealing whether an address exists. `POST /api/auth/verify-email` consumes the proof, invalidates any legacy unverified credential, revokes prior sessions/reset proofs and returns `{ ok: true, next, requiresPasswordSetup }` with `Cache-Control: no-store` and **no session cookies**. New proofs lead to the single-use, 10-minute password setup page. The mailbox owner chooses one password; a trusted, server-issued setup token (persisted `psu_` purpose marker, not the `setup=1` query) permits a fresh customer session on success. Ordinary recovery (`prt_`) never auto-authenticates. An inactive workspace or transient session failure falls back to normal sign-in. Already-verified accounts return `/login` unchanged; invitation/plan context grants no authorization.

## Development

Node.js 24.22.1 is the project runtime baseline.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
cd agent && go test ./... && go test -race ./...
```

PostgreSQL, Odoo 19, Windows, and physical-printer E2E are release gates and must only be reported as passing when the real environment has executed them.

For a production server first deployment and end-to-end smoke test, follow [SERVER_FIRST_RUN.md](SERVER_FIRST_RUN.md).

See [API.md](API.md), [INSTALLATION.md](INSTALLATION.md), [DEPLOYMENT.md](DEPLOYMENT.md), [OPERATIONS.md](OPERATIONS.md), [SECURITY.md](SECURITY.md), [TYPOGRAPHY.md](TYPOGRAPHY.md).

## Engineering review and cross-component contracts

See the [unified system logic notebook](docs/engineering/SYSTEM_UNIFICATION_NOTEBOOK.md) and [complete tracked-file coverage ledger](docs/engineering/FILE_COVERAGE_LEDGER.md). These are evidence-scoped, living audit records, **not** a claim that all integration or hardware release gates passed.
