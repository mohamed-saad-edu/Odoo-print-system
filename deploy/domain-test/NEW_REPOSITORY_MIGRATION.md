# Staging port to the education GitHub repository

Source: mo7medSa3d/oddo-print, branch test/http-server-ready, commit d9061bfbd67e630aad6851ea6adcf40233a88347.
Destination: mohamed-saad-edu/Odoo-print-system, staging branch test/http-server-ready.
Based on destination main commit 11bb3edd6a037bc0f49094a4bb1befe07396dd35.

This branch carries staging-only HTTPS deployment, Caddy, PostgreSQL configuration,
fake Stripe test price catalog, single-workspace signup guards, trial diagnostics,
E2E Capture documentation, and staging contract tests.

Compatibility decisions:
- Keep modern main dependency versions and SHA-pinned GitHub Actions.
- Preserve modern main printer-intent failure recovery; do not backport legacy recovery.
- Keep the main change-scope scripts and their tests to limit CI runner minutes.
- Do not port historical Gitleaks fingerprints tied to unrelated commit history.
- Retain legacy HTTP deployment files only for migration history: HTTPS domain staging is supported.
- Use modern main Docker/Odoo registry fallback and its associated contract tests.

Environment safety:
- This Git branch does not transfer databases, Docker volumes, DNS, TLS certificates,
  secrets, user accounts, printer registrations, Agent pairing, or production settings.
- Back up the existing staging database and protected environment settings before deploying.
- Do not run reset-staging-workspace.sh unless a deliberate staging-only reset is intended.
- Do not merge this staging-only code into the production main branch.

On the staging server, review local changes before switching to test/http-server-ready,
then use deploy/domain-test/setup-domain-test.sh for the HTTPS deployment.
