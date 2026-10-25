# Yaseir V5 isolated-source implementation plan (2026-10-25)

## Authority and constraints
Only the uploaded V5 ZIP is authoritative. Do not use historical repositories, branches or artifacts. Do not deploy or reset database state. Production rollout stays NO-GO until real Windows/Odoo 19/hardware, multi-tenant database and secure deployment gates are evidenced.

## Task 1: Baseline and integrity
- Verify ZIP CRC, paths, modes, inventory and SHA-256.
- Run available standalone Node/Python tests, record toolchain gaps and failures.
- Keep evidence logs separate from source and preserve the upload.

## Task 2: TLS regression root cause
- Reproduce Python/OpenSSL TLS trust fixture failure in `tests/test_odoo_gateway_real_tls.py`.
- Build a standards-compliant ephemeral CA/server chain with Subject/Authority Key Identifiers (without relaxing production verification).
- Re-run positive trust and negative untrusted/wrong-host/redirect/proxy cases.

## Task 3: Odoo printer company/branch accuracy
- Add TDD coverage for same-name company/branch labeling, duplicate IDs, explicit branch choice, and revoked active/explicit scope.
- Update `static/src/js/printer_scope_labels.js` and `printers_overview.js/xml` so role labels and selection are unambiguous; invalidated choices fail closed, never silently select the first other company.
- Make nested branches visibly unsupported where the binding schema enforces direct children; never silently route to an ancestor or sibling. Add tests and upgrade/install documentation.
- Keep exact company/branch identities and authorization unchanged for supported cases.

## Task 4: Broad static verification and packaging
- Execute all available relevant tests, formatting, i18n, static checks and security scans. Mark missing Node24/Go1.26/Rust/Docker/Postgres/Odoo19/Windows/hardware as BLOCKED rather than PASS.
- Deliver modified full source, separate evidence, issue register, readiness, non-destructive upgrade/rollback notes and verified checksums.
