# Odoo 19 hardened image — vulnerability review, 2026-11-05

Scope: the `yaseir-odoo-hardened` image exception list in
`security/image-vulnerability-baseline.json` (tag `review-20261105`), after CI
reported "63 inherited vulnerabilities remain in pinned upstream image" and
the previous review's expiry (2026-11-08) approached. This review either
removes findings that gained a real fix or re-confirms them with fresh
scanner evidence; it adds no new exemptions.

## Method

Both candidate parents were scanned directly from the official registry
with Trivy (all severities, unfixed findings included), the same scanner CI
enforces with:

- Pinned parent: `odoo:19.0@sha256:08af340902122af116a92c917359cd8bb411ca6960c0b4877dc636423a8d5b26`
  — 226 findings (7 HIGH, 169 MEDIUM, 50 LOW).
- Current upstream amd64 build: `odoo:19.0@sha256:08374de09bab5d80851c5709896aa49917e6c6a893b39025d6669db908e238b0`
  — 115 findings (2 HIGH, 97 MEDIUM, 16 LOW).

Local scanner/database versions can differ slightly from the CI action's;
one baseline row (CVE-2026-95209, libgnutls30t64) was not reproduced by this
review's database in either parent and is retained in the baseline
regardless, because extra reviewed rows never authorize a finding the scan
does not report.

## Parent update decision: pin unchanged

The newer upstream build introduces **zero** findings that the pinned
parent does not already have, and removes **none** of the 63 reviewed
findings — every one of them is still present, because none has a published
fixed version in Ubuntu noble. Its only HIGH findings are the
`apt`/`libapt-pkg6.0t64` pair (CVE-2026-109518) that the hardened recipe
already purges. Updating the parent would therefore not reduce the reviewed
set at all, while invalidating every exact previous-version fence in
`Dockerfile.odoo-hardened`. The pin stays at `08af3409…` until an upstream
build actually fixes reviewed findings; the final-image scan remains the
gate that proves any future update.

## Fix applied: libpcre2-8-0 (7 findings removed)

USN-8974-1 (published 2026-11-03, after the retained
`20261024T000000Z` snapshot was pinned) released the first noble fix for
all seven reviewed `libpcre2-8-0` findings: CVE-2026-103111,
CVE-2026-86145, CVE-2026-89156, CVE-2026-89157, CVE-2026-89158,
CVE-2026-89160, CVE-2026-89161 — fixed in `10.42-4ubuntu2.2`
(installed in the parent: `10.42-4ubuntu2.1`).

The recipe now carries that exact package in the OS security profile,
following the libbrotli1 precedent for post-snapshot noble-security fixes:

- `libpcre2-8-0_10.42-4ubuntu2.2_amd64.deb` from
  `security.ubuntu.com/ubuntu/pool/main/p/pcre2/`, 228,546 bytes,
  SHA-256 `f41da7cb7e979d6b037ea92650c72ec8ec532ec3c93aa8d5b997207de56695ea`,
  verified from the downloaded artifact's own dpkg control fields
  (Package, Version, Architecture, Depends: `libc6 (>= 2.34)`).
- Recorded in `docs/runtime-hardening/os-security-artifacts.json`
  (artifact entry plus `additional_package_provenance`), fenced in
  `Dockerfile.odoo-hardened` by the same previous/fixed version records,
  `dpkg -i` list and post-install version assertions as every other
  carried package.
- The seven findings are removed from the baseline; they must not
  reappear in the final-image scan.

## Remaining reviewed findings: 57 (42 MEDIUM, 15 LOW)

Clusters: libsass1 (9), libnode109 (7), nodejs (7), libgnutls30t64 (6),
libopenjp2-7 (3), libcairo2 (2), libxslt1.1 (2), dash (2), libc-bin (2),
libc6 (2), tar (2), and 15 single-finding packages. None has a Trivy
Fixed Version in the pinned or the current upstream parent — they are
inherited, not fixed, and stay time-bound reviewed only. No
HIGH/CRITICAL/UNKNOWN findings are exempted. Expiry renewed to
**2026-11-19**, in line with the other image reviews in the same file.

## Gates

The CI `odoo19` job rebuilds the image, runs the native addon tests,
generates the SBOM/SARIF and enforces this baseline fail-closed; the CI
source-hash pin was updated to the revised Dockerfile
(`e0b53faaffac09d7473569151a1e1ed13d133a84`). Those container gates run in
CI — this review's host evidence is the registry scans and artifact
verification above, not a rebuilt-image scan.
