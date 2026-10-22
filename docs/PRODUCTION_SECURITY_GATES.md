# Production release security gates

These are operational gates, not substitutes for source-level CI. GitHub's
installed application token cannot enable protected-branch Rulesets, purchase a
public Windows code-signing certificate, or configure a host firewall.

## Repository administrator (GitHub Settings > Rules > Rulesets)

- Protect the `main` ref from ordinary direct pushes and force-pushes.
- Require an independently reviewed PR, including the relevant CODEOWNERS
  (`@mohamed-saad-edu`), before changing auth, Odoo credentials, payment,
  printing admissions or workflow files.
- Require relevant CI/security checks, including `App / Gateway`, and
  Agent/Go, Odoo 19, Docker and Windows checks for changed paths. Check the
  exact contexts published in the latest successful workflow run; some
  filtered jobs legitimately report `skipped`.
- Enable GitHub Dependency Graph and dependency-review-action support for this
  private repository; then set `ENABLE_DEPENDENCY_REVIEW=true`. Until available,
  the dedicated supply-chain workflow checks npm, Go, Cargo and pinned images
  with explicitly expiring vulnerability exceptions.

## Production VPS/Odoo/network administrator

- Keep only Caddy ports 80/443 publicly exposed. Deny metadata IPs and
  private control-plane destinations at the Odoo host/container egress firewall;
  code-side DNS checks alone cannot eliminate DNS-rebinding TOCTOU.
- For Odoo configured to use a private Gateway, explicitly add the *exact*
  origin to `YASEIR_GATEWAY_ALLOWED_ORIGINS` in the Odoo service environment.
  The allowlist uses exact scheme/hostname/port matching. Never allowlist
  a metadata IP (169.254.169.254, 100.100.100.200, etc.).
- Require remote HTTPS for every Gateway Agent. HTTP development opt-in is
  limited to local loopback; Odoo additionally requires an exact origin
  allowlist for a deliberately local Gateway.
- From a trusted external operator machine, after `npm ci`:
  `node scripts/check-public-gateway.mjs https://your-gateway.example.com`.
  This tests public certificate validation, DB readiness and the protected
  WSS authentication boundary. Run a paired real-Agent/real-printer job after it.
- Keep automated PostgreSQL backups off-host, practice restore, and record
  measured RPO/RTO and proof of Windows service and paper delivery.

## Windows release operator

- Supply an organization-owned trusted code-signing PFX and password to
  GitHub Actions. The runner-local self-signed artifact is explicitly
  `UNTRUSTED-TEST-ONLY`; never distribute it as an official installer.
- Validate the resulting executable/NSIS Authenticode signature and run a
  Windows install/print/uninstall acceptance with hardware.

## Outstanding upstream dependency advisories

The immutable `security/image-vulnerability-baseline.json` records inherited HIGH/CRITICAL
findings in pinned official parent images. Production Caddy and PostgreSQL
are now rebuilt using the patched Go 1.26.10 toolchain and their *actual*
final images are independently scanned with zero high-severity exceptions.
Do not erase findings to create a green report. Keep scanning pinned upstream
images; update each digest only after rebuilding/scanning the real replacement
and testing deployment. The Node *runtime* image removes bundled npm to
reduce exposure, but CI still scans the official Node base image, where the
bundled npm advisories remain. The upstream gosu/Caddy advisories remain documented only for historical
reference; the patched final images must not ship those binaries.

Review every exception before its expiry in the baseline JSON.
