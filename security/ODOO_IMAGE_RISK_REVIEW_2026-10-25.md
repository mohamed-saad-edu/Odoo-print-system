# Odoo 19 hardened image — time-bound security review (2026-10-25)

## Scope and evidence
- GitHub CI builds and scans the EXACT immutable local image ID, not a stale upstream base tag.
- The 2026-10-24 SARIF contained 82 results: 7 HIGH, 58 MEDIUM, 17 LOW.
- The HIGH results were 3 static private keys shipped in unrelated upstream Odoo add-ons, one msgpack, one setuptools, and two urllib3 findings. Three further fixed-version LOW/MEDIUM findings were in obsolete setuptools and urllib3.
- The Dockerfile now removes the three upstream bundled private keys and removes the runtime pip package and its obsolete vendored Python dependencies (without removing patched runtime libraries). Runtime is isolated in a hash-pinned virtual environment containing urllib3 2.8.0 and setuptools 84.2.1. Successful native Odoo tests and a fresh scan are mandatory evidence of the changes.
- The 72 entries in security/image-vulnerability-baseline.json are the **exact** LOW/MEDIUM findings for which Trivy reported no fixed version on the recorded image. They are risk-tracked; **they are not fixed** and must not be presented as zero vulnerabilities.

## Policy
Trivy still executes against the tested final image and writes full SARIF for every severity, including unfixed and unknown. A separate fail-closed gate permits only the 72 individually identified LOW/MEDIUM entries until 2026-11-08. HIGH/CRITICAL, secrets, unknown, new, mismatched and expired findings always fail. Pinned Dockerfile and Python lockfile git-blob identities must match the reviewed profile. A future image change triggers a renewed review rather than silently inheriting this acceptance.

## Follow-up needed before release sign-off
Review and upgrade inherited Ubuntu packages when fixed versions are available, replace the legacy Ubuntu-packaged Node 18 / libnode109, reassess Python distro packages and the inherited official Odoo deb (the service starts from independently pinned Odoo Git source), and assess affected parsing paths such as libxslt, pdfminer, glibc and libgnutls. Preserve minimum privileges, isolated networking, explicit HTTPS and PDF bounds. Security exceptions expire automatically; CI green with reviewed exceptions is **not** production readiness.
