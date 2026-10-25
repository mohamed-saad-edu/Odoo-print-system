# Exact historical Gitleaks fingerprints — staging PR compatibility

Scan: GitHub Actions Secret Scan / Gitleaks 8.24.3; the existing PR against main rechecks older V3/V4 commits already in main.

Each entry in `.gitleaksignore` is tied to the **original commit SHA, original source file, generic-api-key rule, and original line number**. It cannot suppress a new commit or a changed line, nor an unrelated finding in the same file. No broad allowlist or scanner disablement.

* One old V4 migration comment accidentally resembled an API key. The present source uses a different comment.
* Fourteen Alpine security provenance `key_sha256` values identify **public signing keys**. They are integrity-check digests, not private key material; their values must remain byte-exact.
* One base64 WebSocket `sec-websocket-key` belongs to a fixed integration-test handshake fixture, not an API credential.

These are the 16 fingerprints reported in the PR's Gitleaks run. If a future scan reports any further finding, treat it as unreviewed; investigate the secret and rotate if real. Do not modify this file to bypass a genuine leaked credential.

PR scan evidence: https://github.com/mohamed-saad-edu/Odoo-print-system/actions/runs/40240014742
