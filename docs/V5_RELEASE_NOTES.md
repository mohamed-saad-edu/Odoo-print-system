# Yaseir V5 scoped hardening release notes

The authoritative baseline is the V5 source archive supplied with this execution,
SHA-256 `e6f434bfeb8038c1e6a03b82fbc4526c927d95ae62b0f86ef27855ff6acefd87`.
No previous branch, repository or older project artifact was consulted or merged.

## Implemented source changes

- Odoo printer setup-context names remain unique even when a user supplied
  a company name containing an already generated ID suffix.
- Odoo runtime printer RPC requests reject ambiguous explicit company/branch
  IDs (`true`, fractional numbers, padded strings and values outside the
  database integer range), rather than silently coercing to another record.
- Odoo OWL printers-screen company and Agent `<option>` selected values now
  explicitly track the state used in printer routing requests.
- Legacy browser scope normalization produces unambiguous final visible
  names, including generated ID and "Unavailable" suffix collisions.
- `print_gateway` manifest version bumped from `19.0.2.24.0` to
  `19.0.2.25.0`; see `ODOO_INTEGRATION.md` for the non-destructive,
  **database-specific** upgrade and asset invalidation checklist.
- Added isolated Python and Node source-method regression cases.

## Critical release limitations

These changes are **not** a complete platform-wide production certification.
No native Odoo 19 upgrade/browser bundle, native Windows service, physical
printer output, Go 1.26.10, Rust/Tauri, Node 24 dependency-backed build,
PostgreSQL restore drill, TLS deployment or penetration testing was executed
in this environment. Release verdict: **NO-GO**.

## Original user-supplied binary font assets

This downloadable source package excludes 15 unchanged binary font assets.
Restore the exact original, SHA-256-verified assets from your own uploaded
V5 source ZIP before any build or UI validation:

```bash
python3 scripts/restore_v5_original_font_assets.py \
  '/path/to/YASEIR_V5_PRODUCTION_SOURCE_FINAL(3).zip'
```

The helper neither downloads fonts nor accepts replacements with different
content. The original user-uploaded ZIP was never modified.
