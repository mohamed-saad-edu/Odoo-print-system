# Odoo Integration Guide

> Module: `print_gateway` | Version: 19.0.2.17.0 | Odoo: 19 Community Edition

## Overview

The Yaseir Print Gateway Odoo addon enables silent, hardware-level printing from Odoo ERP to physical printers through the central Gateway. Odoo owns all business context (what to print, where to print); the Gateway owns runtime infrastructure (agents, printers, job queue).

Document test pages use the selected runtime printer's optional `capabilities.paper_width_mm` (58 or 80) to generate a matching 100mm-long source ticket. The Gateway inventory and Odoo picker retain this physical-media field separately from `printableWidthDots`. Windows spooler tests can use the selected driver's validated paper when roll metadata is unavailable: the Agent tries the document form, then fits the complete page proportionally inside that same driver's printable area before submission. A direct IPP POS/kitchen binding (`pos`/`pos_printer`) with exact `deviceClass=thermal` still requires declared integer58/80mm; no Windows driver is available on that direct path. Other source formats remain: ASCII uses Letter with bounded wrapped metadata, Unicode uses the Odoo report/company paperformat. Names and `document_type` do not establish media. Actual report files retain their layout, while their Windows output uses the same complete-page fit. No global paperformat or installed-printer defaults are modified; submission remains informational until paper is observed.

TSPL Test Print sends the firmware's documented `SELFTEST` command rather than imposing75×50mm stock or a2mm gap. ZPL Test Print sends one compact buffered `TEST` label without changing stock, gap or calibration. Actual application label programs are unchanged and still require the printer's real language and configured media. Check Setup/Test Connection remain control-plane checks, and E2E Capture remains rendering-only; Test Print uses the exact binding and durable physical-job outbox.

## Architecture

```
Odoo 19 ──────────────────────────────────────────────┐
│ Gateway Config (URL + API key per root company)     │
│ Binding (Company/Branch/Destination → Agent/Printer)│
│ Print Router (rendering + dispatch)                 │
│ Print Policy (event-driven automation)              │
│ Print Intent (durable outbox)                       │
└─────────┬───────────────────────────────────────────┘
          │ HTTPS API calls
          ▼
     Gateway (job queue, claim fencing, agent delivery)
          │
          ▼
     Go Agent (physical print execution)
```

## Models

| Model | Purpose |
|-------|---------|
| `print_gateway.gateway_config` | Gateway connection (URL + API key) per root company |
| `print_gateway.binding` | Maps (Company, Branch, Destination, Document Type) → (Agent, Printer) |
| `print_gateway.policy` | Event-driven print automation rules |
| `print_gateway.intent` | Durable outbox for asynchronous dispatch |
| `print_gateway.print_job` | Odoo-side job tracking |
| `print_gateway.runtime_agent_assignment` | Branch → Agent mapping |
| `print_gateway.pair_agent_wizard` | Guided Gateway agent pairing flow |
| _`print_gateway.crypto`_ | AES-GCM utility module (not a model) |

## Report Interception (2 Layers)

### Layer 1: ORM Level (`ir_actions_report.py`)
Overrides `report_action()` to intercept `ir.actions.report` execution. If a binding exists, the report is dispatched to the Gateway and a notification is shown instead of opening a PDF.

### Layer 2: Client-Side JS (`report_interceptor.js`)
Uses the supported Odoo 19 client-side report action interception path to stop the native PDF download flow when Gateway printing is selected.

Odoo's native `/report/download` HTTP controller remains untouched.

**Fail-Closed Policy**: If a binding exists but dispatch fails, the native PDF download is cancelled. The operator sees an error notification with a link to the Print Jobs list.

## POS Integration

### Receipt Printing (`pos_print_router.js`)
Patches `PosStore.prototype.printReceipt` to:
1. Check if Gateway printing is enabled for the POS session
2. Render the receipt to a JPEG image (using OWL renderer → canvas → base64)
3. Submit the image to `pos.order.action_print_gateway_receipt`

### Kitchen/Preparation Printing
Patches `PosStore.prototype.printChanges` so Gateway-enabled POS kitchen tickets preserve Odoo 19's native `pos.printer`/product-category routing; the native `pos.printer` is the logical preparation destination, while the Gateway Runtime Printer is the physical target.

### Sale Details Report (`pos.py`)
Intercepts the `/pos/sale_details_report` route for Z-report printing.

## Binding Configuration

### Hierarchy

```
Root Company
├── Branch A
│   ├── Binding: POS Counter → Agent-1 / Receipt Printer
│   └── Binding: Kitchen → Agent-1 / Gateway Runtime Printer
└── Branch B
    └── Binding: POS Counter → Agent-2 / Receipt Printer
```

### Binding Fields

| Field | Description |
|-------|-------------|
| `company_id` | Root Odoo company (not a branch) |
| `branch_id` | Optional Odoo branch (child company) |
| `destination_type` | POS Receipt, POS Kitchen / Preparation, Operation Type, or Report |
| `runtime_agent_id` | Gateway agent ID |
| `printer_id` | Gateway printer ID |
| `printer_protocol` | Required: escpos, zpl, tspl, raw, spooler, windows_spooler, ipp, ipps, unknown |
| `report_id` | Single operator-facing Odoo report selector for backend/document bindings; POS Receipt and POS Kitchen / Preparation bindings do not require a report |
| `fallback_binding_id` | Pre-dispatch failover if primary printer is offline |

### Validation Rules

- Root company must not be a branch
- Branch must belong to the selected root company
- A Branch binding requires an Agent assigned to that exact Branch; a Company-only binding may use any Agent assigned to the Company or one of its direct child Branches
- Printer must belong to the selected agent
- POS Receipt bindings are rendered by the POS client and do not require a PDF report
- POS Kitchen / Preparation bindings use the native Odoo 19 Preparation Printer as the logical category-aware destination and the Gateway Runtime Printer as the physical target
- An Odoo 19 `pos.printer` is required when using category-aware Gateway Kitchen / Preparation routing; a POS Shop binding remains available only as a compatibility fallback when no native Preparation Printer binding exists
- POS receipts and kitchen tickets require a rendered-image transport: a real Windows spooler queue (including installed laser/inkjet queues) or a supported ESC/POS network raster path. Direct IPP/USB byte transports and conflicting explicit capabilities are excluded from this JPEG route.

## Print Policy Automation

Policies fire on business events (e.g., `pos_order_paid`) and create durable intents that are dispatched asynchronously:

```python
# Branch-aware lookup: root company + branch scope (see
# print_policy.resolve_for_record), not the bare order company.
root_company = order.company_id.parent_id or order.company_id
branch = order.company_id if order.company_id.parent_id else False
policies = policy_model.search([
    ("model_id.model", "=", "pos.order"),
    ("event_type", "=", "pos_order_paid"),
    ("company_id", "=", root_company.id),
    ("branch_id", "in", [False, branch.id] if branch else [False]),
    ("active", "=", True),
])
```

Multi-destination fan-out is supported (same order → receipt printer AND kitchen printer), with same-target deduplication.

## Gateway Configuration

Each root company needs one `gateway_config` record with:
- `gateway_url`: The Gateway's public URL
- `gateway_api_key`: The installation API key created in the Gateway dashboard
- `enabled`: Boolean flag

The config is tested via the Gateway's `/api/odoo/health` endpoint during setup.

### Report Destination
For `destination_type = Report`, the operator selects exactly one `Report`. The legacy `destination_report_id` field is retained only for compatibility with pre-2.10 data and is hidden from the form.

Discovery reports use the additive `errors: string[]` contract in `contracts/print-payload-contract.json` (maximum 64 messages, 2048 UTF-16 units each). The Gateway returns these in session `stats.errors`; optional unavailable device fields are omitted, and protocol defaults to `unknown`. Odoo consumes approved runtime printers, not discovery candidates or source diagnostics; no addon producer emits discovery reports.

## Diagnostic test-print compatibility

`Send Test Page` treats the explicitly selected valid binding as authoritative: it validates that binding and its current runtime Agent/printer identity and does **not** independently resolve a second binding to compare against it. The test uses the binding's real document type, then chooses the payload from the printer's current runtime transport—not from a stale protocol field or marketing device class. A Windows-installed queue (`connectionType=spooler`) receives a real PDF through the Agent's Windows document-rendering path, so laser, inkjet, thermal, USB, WSD, and network printers are testable when they are installed as a working Windows queue with a usable driver. IPP/IPPS printers receive PDF through IPP. ESC/POS, ZPL, TSPL, and explicit raw byte transports receive protocol-specific diagnostics. Direct USB/TCP devices with an unknown byte language remain intentionally non-routable: the system will not guess a language or send arbitrary PDF bytes to them.

Printer status and Agent connectivity are separate evidence. A lost/stale Agent heartbeat is displayed as an Agent connectivity problem; it does not rewrite the last printer observation to physical `offline`. Stale printer observations become `unknown` until fresh evidence arrives. Odoo runtime pickers render the Gateway `status` as the current state; `reportedStatus` is retained only for diagnostics/history and is never promoted to current Online/Offline once `freshness` is stale or missing.

The Agent decides which local printers are shared with Gateway. Private queues are excluded from Odoo runtime selectors without deleting saved binding IDs or job history. A stale explicit private binding is unavailable and new dispatch returns `PRINTER_NOT_SHARED`; it does not silently select another printer. Re-sharing restores selection only after a newer Agent snapshot passes Gateway capacity and lifecycle checks. Existing admitted outcomes continue to reconcile; successful submission still requires operator verification of paper output.

### Upgrade gate for print status fairness (19.0.2.13.0)

The `print_gateway.print_job` model now stores and indexes `last_status_polled_at`
to fairly reconcile active Gateway jobs instead of repeatedly polling an oldest-ID
prefix. Existing installations **must upgrade** the addon (`-u print_gateway`)
against a backed-up Odoo 19 database before activating the updated polling cron.
Confirm schema/index creation and test concurrent cron polling, job status
reconciliation, all supported print routes, and rollback in staging. The standalone
source tests do not establish PostgreSQL migration or native Odoo acceptance.

### Why no data-migration folders for 19.0.2.11.0–19.0.2.13.0

Those releases add only nullable columns with safe defaults
(`status_sync_attempted_at`, `allow_additional_pos_output`,
`last_status_polled_at`) plus JS assets. Odoo creates the columns and
indexes during the required `-u print_gateway` above; no row backfill,
rename, or split exists, so no `migrations/19.0.2.1x.0` folder is needed.
A future release that renames a field, splits a column, or rewrites stored
routing keys MUST ship a corresponding migration folder (as 19.0.2.10.0 did
for `destination_ref`/`document_type`).

### Intent company ownership upgrade (19.0.2.14.0)

Upgrade the addon (`-u print_gateway`) before enabling its workers. Intent
`company_id` is now required so company record rules and recovery workers see
the same owned rows. The pre-migration preserves existing ownership and fills
legacy missing companies from the linked outbox job, then the actual source
record for invoice, picking, sale, purchase, and POS flows. A company-wide
policy may match a branch and cannot establish which company owned an event.
Rows without a provable company block the upgrade with sample IDs; restore
their source record or set the verified company before retrying. Back up and
exercise upgrade/rollback on an Odoo 19 database in staging.

### Scheduled automation review (19.0.2.15.0)

The addon defines five native scheduled actions: submit queued jobs, reconcile
Gateway status, recover committed business-event intents, synchronize activation,
and remove retained terminal jobs. Invoice posting, completed inventory moves,
and POS events stage intents inside the business transaction; external dispatch
runs only after commit, with cron recovery for missed callbacks. A rollback must
not print. An intent being dispatched means its durable print job exists; it does
not establish paper output.

Status reconciliation and activation synchronization yield when Odoo 19's
`_commit_progress()` time budget is exhausted. Failed batch-status requests cannot
start a long sequence of individual HTTP requests without another budget check.
Existing retry delays, exact company/binding ownership, and ambiguous physical
outcomes remain authoritative. See the [official Odoo 19 scheduler implementation](https://github.com/odoo/odoo/blob/19.0/odoo/addons/base/models/ir_cron.py).

### Shared typography system (19.0.2.16.0)

The add-on now ships the shared typography system used by the Web console and
the Desktop Manager. The module carries a byte-identical copy of
`typography/tokens.css` (`static/src/css/typography_tokens.css`) and the IBM Plex
families under `static/fonts/`, declared with `@font-face` and
`font-display: block` in `static/src/css/typography_fonts.css`. The font URLs
are module-relative, so the server's PDF engine can fetch them while rendering
a report. A printable document opts in with the `yaseir-typography` class;
Odoo's own reports are untouched.

The POS receipt raster is a deliberate exception and renders exactly as
before: it is a fixed-dot canvas measured against the printer's dot budget,
its metrics are pinned by the measured geometry fixture, and the capture runs
with font embedding disabled, so it must never depend on a web font.

Upgrade with `-u print_gateway` and rebuild/reload the normal Odoo asset bundles
to apply the menu and POS changes. This release changes no schema or dependency;
the 19.0.2.14.0 ownership migration still applies when upgrading older databases.
Validate the scheduled actions through `ir.cron.method_direct_trigger()` in an
Odoo registry test environment, then exercise actual invoice, stock, POS,
multi-company, rollback, outage and recovery flows in staging. Offline source
tests cannot establish native ORM, scheduler, asset or physical-printer acceptance.

## Automatic installation identities (zero-touch Version 2)

**Newly provisioned Gateway workspaces start in strict-v2 automatically.**
Legacy workspaces are NOT automatically converted, even when they appear empty,
because a disconnected Odoo database could still have an external print outbox.
There is no Gateway Installation ID to copy or Version 2 Identity Cutover checkbox for
the customer to activate. Every independent Odoo database/root-company scope
creates its own UUIDv4 and 256-bit installation proof automatically and stores
them in a private JSON file inside the Odoo service's persistent
\`data_dir/yaseir-print-installations/\` directory. The proof never enters
the Odoo database, so a normal database-only clone cannot copy the proof.

On "Test Connection" and at the actual print-job submission boundary, the
addon sends its installation identity over HTTPS to
\`POST /api/odoo/installations/auto\` using the existing Odoo API key.
Enrollment is repeatable and safe to retry after a lost HTTP response. One
Gateway workspace and API key can register multiple Odoo database identities,
even if their Odoo company and operation IDs happen to match.

**Integration activation:** The existing Odoo Enable/Disable state remains scoped
to its API key, not per database. If multiple Odoo databases share one API
key, disabling it in one Odoo database disables printing for all databases
using that key. For independent enable/disable control, issue a separate
Odoo API key for each database. IDs and version cutovers are still automatic
in either case.

**Installation:** Make the Odoo \`data_dir\` persistent and writable by the
Odoo process. Back up its \`yaseir-print-installations/\` credentials using a
separate encrypted/secret backup policy. Do not share that directory between
unrelated Odoo hosts. No customer needs to copy the proof into environment
variables for a fresh deployment.

**Restores:** A database-only clone with a different database name or data
directory gets a new installation identity. All previously persisted print
jobs retain their original identity, and will stop rather than be dispatched
as fresh prints by the clone. Full virtual machine/filesystem clones can
also copy the private identity files, so operators must deliberately rotate
the enrollment after a FULL host clone, not treat it as two independent hosts.

**Existing deployments:** Any pre-existing Gateway workspace still in `legacy`
mode must undergo a separate operator-reviewed cutover. Automatic enrollment
returns a recoverable `RECONCILIATION_REQUIRED` error rather than silently
promoting that workspace. This prevents accidental replay of historical Odoo
outbox jobs that may live outside the Gateway database.

## Installation-scoped idempotency (S06-006)

Starting with forward migration `0085_odoo_installation_idempotency`, independent Odoo databases using one Gateway tenant can opt into a server-enrolled version-2 namespace. Historical v1 operations and lifetime receipts retain their original identities. Tenants already in legacy mode remain there until an administrator explicitly completes the reconciliation and one-way strict cutover; brand-new tenants start in strict-v2 by default.

For a pre-existing legacy workspace, follow a reviewed manual cutover procedure: secure enrollment, external 256-bit installation proofs, API-key rotation, verification of old receipts, operator-controlled `reuse`/`distinct` decisions, and clone/restore restrictions. Never regenerate a key for a pre-existing Odoo outbox job. A pending historical operation requires reconciliation, not a new physical print.

The Gateway installation-management endpoints are `/api/odoo/installations`, `/api/odoo/installations/resolutions`, and `/api/odoo/installations/cutover` (workspace-manager permissions required). Versioned Odoo job submission and status reads continue through the existing `/api/print/jobs` and `/api/print/jobs/v2` routes, with an additional independently enrolled installation identity and proof. Older Agents continue to receive the existing print job and acknowledgment schema; they do not interpret the Odoo source-key version.
