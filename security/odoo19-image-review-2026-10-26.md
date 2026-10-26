# Odoo 19 image vulnerability remediation — 2026-10-26

**Repository:** `mohamed-saad-edu/Odoo-print-system` / `main` at pre-change commit `4cd933f6391b0e186933bf83c5eac87905f31ee1`  
**Evidence:** GitHub Actions [run 40265315273](https://github.com/mohamed-saad-edu/Odoo-print-system/actions/runs/40265315273), artifact `odoo-hardened-image` (CycloneDX/SARIF/Odoo test log).  
**Scope:** `odoo:19.0@sha256:08af340902122af116a92c917359cd8bb411ca6960c0b4877dc636423a8d5b26`, Odoo source `14f9b8149d5260d92fb74404df09483fb42dd820`, CPython 3.12.15.  
**Review validity:** ends **2026-11-08** without renewal. No production security signoff.

## Evidence and bounded remediation

- Previous image: 394 SBOM components, exactly 72 SARIF findings: 56 MEDIUM and 16 LOW; all reported an empty `Fixed Version`. Actual native Odoo CI: 292 post-tests / zero failures or errors (322 module test events).
- Odoo binary-package SBOM graph: `python3-pip`, `python3-wheel`, and `python3-pdfminer` have no Odoo Debian reverse dependency (system `python3-wheel` only has `python3-pip` as reverse dependent). The actual app is a detached, pinned Git checkout running under a dedicated CPython 3.12 venv with its own hash-pinned dependencies and `pypdf`.
- Dockerfile now checks these **exact upstream installed versions**, purges only these three unused Ubuntu packages **after** venv construction, fails on unexpected package/version or lingering system Python imports, and exercises `odoo-bin --version`. It does not use apt upgrades, cross-release packages, forced removal, or an Odoo version bump.
- Expected remediated scan: **64** retained findings (49 MEDIUM, 15 LOW) if the exact GitHub Actions image build/SBOM/SARIF checks pass. This is a **prediction**, not proof until a new run and its SARIF are inspected.
- Baseline removes precisely the eight retired package tuples and keeps its original expiry; any residual/reintroduced CVE from those packages now blocks the image gate. Odoo HIGH/CRITICAL/UNKNOWN are rejected even if someone adds them to the baseline.

## Upstream status and shipping gates

- `python3-pdfminer`: Ubuntu [USN-8837-1](https://ubuntu.com/security/notices/USN-8837-1) offers an ESM Apps fix for Noble; removal is safer here if validated because the system package is unused. Removing it mitigates exposure, it does **not** constitute an upstream vulnerability patch.
- `libxslt1.1`: Noble marks [CVE-2025-10911](https://ubuntu.com/security/CVE-2025-10911) deferred; validate 2025-7425 separately before any ABI-level replacement. Do **not** import a Debian package or build a homebrew libxslt without Odoo/XML/EDI tests.
- `libexpat1`: Noble marks [CVE-2025-66382](https://ubuntu.com/security/CVE-2025-66382) deferred. Treat arbitrary attacker-supplied XML as a risk; no blind library upgrade.
- `libnode109` / `nodejs`: Node 18 is inherited, with 14 findings across both package records. RTL CSS depends on the JS build chain; a Node migration needs real Odoo assets/Arabic rendering tests. Individual CVE applicability can differ from Trivy package matches.
- `libsass1`: nine findings. The parent `odoo` .deb depends on `python3-libsass`, which depends on `libsass1`; purge without planning would break package dependency integrity.
- `odoo` .deb: its old `CVE-2020-29396` finding remains even though active application code is a separately pinned Odoo 19 checkout; verify reachability separately before any VEX conclusion.
- `libc6`, `libpcre2-8-0`, `libgnutls30t64`, and PDF/font/XML/graphics libraries remain in the live dependency chain; use only Ubuntu Noble verified security rebuilds and smoke-test PDF rendering, asset compilation, Arabic/RTL, and Odoo addon integration.
- `libxrender1` [CVE-2026-88807](https://ubuntu.com/security/CVE-2026-88807) is deferred in Noble. `wkhtmltox` requires X11/PDF libraries; do not remove.
- Actual approval requires **new** exact-image SBOM and SARIF, evidence of absence of retired packages, full Odoo 19 native integration tests, static/security CI, no new severity exemptions, and written review of the 64 residual findings. A green CI by itself is insufficient for production security signoff.
- The 2026-11-08 expiry cannot be extended automatically. If risk remains by that date, fail closed and hold release until reviewed upstream fixes or an explicit human risk decision.

## Per-finding disposition (all original 72)

| CVE | OS package | Scanner severity | Decision and rationale |
|---|---|---|---|
| CVE-2017-10687 | `libsass1` | LOW | REVIEW — upstream Odoo .deb depends on python3-libsass, which depends on libsass1; preserve Debian dependency integrity |
| CVE-2017-11341 | `libsass1` | LOW | REVIEW — upstream Odoo .deb depends on python3-libsass, which depends on libsass1; preserve Debian dependency integrity |
| CVE-2017-11342 | `libsass1` | LOW | REVIEW — upstream Odoo .deb depends on python3-libsass, which depends on libsass1; preserve Debian dependency integrity |
| CVE-2017-11555 | `libsass1` | MEDIUM | REVIEW — upstream Odoo .deb depends on python3-libsass, which depends on libsass1; preserve Debian dependency integrity |
| CVE-2017-11556 | `libsass1` | MEDIUM | REVIEW — upstream Odoo .deb depends on python3-libsass, which depends on libsass1; preserve Debian dependency integrity |
| CVE-2017-11605 | `libsass1` | MEDIUM | REVIEW — upstream Odoo .deb depends on python3-libsass, which depends on libsass1; preserve Debian dependency integrity |
| CVE-2017-12962 | `libsass1` | LOW | REVIEW — upstream Odoo .deb depends on python3-libsass, which depends on libsass1; preserve Debian dependency integrity |
| CVE-2017-12963 | `libsass1` | LOW | REVIEW — upstream Odoo .deb depends on python3-libsass, which depends on libsass1; preserve Debian dependency integrity |
| CVE-2017-12964 | `libsass1` | LOW | REVIEW — upstream Odoo .deb depends on python3-libsass, which depends on libsass1; preserve Debian dependency integrity |
| CVE-2017-7475 | `libcairo2` | LOW | RETAIN — Cairo/image-rendering dependency |
| CVE-2018-18064 | `libcairo2` | LOW | RETAIN — Cairo/image-rendering dependency |
| CVE-2019-6988 | `libopenjp2-7` | LOW | RETAIN — Pillow image/PDF handling dependency |
| CVE-2020-29396 | `odoo` | MEDIUM | REVIEW — parent .deb package remains in image although application source is pinned independent Git checkout; test actual reachability and package removal separately |
| CVE-2023-37769 | `libpixman-1-0` | MEDIUM | RETAIN — Cairo pixel-rendering dependency |
| CVE-2023-39328 | `libopenjp2-7` | MEDIUM | RETAIN — Pillow image/PDF handling dependency |
| CVE-2023-39329 | `libopenjp2-7` | MEDIUM | RETAIN — Pillow image/PDF handling dependency |
| CVE-2024-22018 | `libnode109` | MEDIUM | REVIEW — runtime library for upstream Node.js 18; tied to RTL CSS tooling |
| CVE-2024-22018 | `nodejs` | MEDIUM | REVIEW — Ubuntu Node 18 used by the inherited RTL CSS / JS tooling; cannot replace without Arabic asset test |
| CVE-2024-22020 | `libnode109` | MEDIUM | REVIEW — runtime library for upstream Node.js 18; tied to RTL CSS tooling |
| CVE-2024-22020 | `nodejs` | MEDIUM | REVIEW — Ubuntu Node 18 used by the inherited RTL CSS / JS tooling; cannot replace without Arabic asset test |
| CVE-2024-27982 | `libnode109` | MEDIUM | REVIEW — runtime library for upstream Node.js 18; tied to RTL CSS tooling |
| CVE-2024-27982 | `nodejs` | MEDIUM | REVIEW — Ubuntu Node 18 used by the inherited RTL CSS / JS tooling; cannot replace without Arabic asset test |
| CVE-2024-27983 | `libnode109` | MEDIUM | REVIEW — runtime library for upstream Node.js 18; tied to RTL CSS tooling |
| CVE-2024-27983 | `nodejs` | MEDIUM | REVIEW — Ubuntu Node 18 used by the inherited RTL CSS / JS tooling; cannot replace without Arabic asset test |
| CVE-2024-35195 | `python3-pip` | MEDIUM | REMOVE — Ubuntu system pip; isolated runtime venv already has its hashed packages and pip itself was uninstalled |
| CVE-2024-56433 | `login` | LOW | RETAIN — base system login tooling; removal needs a minimal-parent compatibility test |
| CVE-2024-56433 | `passwd` | LOW | RETAIN — dependency of adduser/user-management tooling |
| CVE-2025-10911 | `libxslt1.1` | MEDIUM | REVIEW — upstream python3-lxml dependency; Noble security status requires independent patch/ABI review |
| CVE-2025-23085 | `libnode109` | MEDIUM | REVIEW — runtime library for upstream Node.js 18; tied to RTL CSS tooling |
| CVE-2025-23085 | `nodejs` | MEDIUM | REVIEW — Ubuntu Node 18 used by the inherited RTL CSS / JS tooling; cannot replace without Arabic asset test |
| CVE-2025-23166 | `libnode109` | MEDIUM | REVIEW — runtime library for upstream Node.js 18; tied to RTL CSS tooling |
| CVE-2025-23166 | `nodejs` | MEDIUM | REVIEW — Ubuntu Node 18 used by the inherited RTL CSS / JS tooling; cannot replace without Arabic asset test |
| CVE-2025-5222 | `libicu74` | LOW | RETAIN — libxml2 internationalization dependency |
| CVE-2025-64512 | `python3-pdfminer` | MEDIUM | REMOVE — Ubuntu system PDF parser, not a direct Odoo Debian dependency; pinned venv uses pypdf |
| CVE-2025-66382 | `libexpat1` | MEDIUM | REVIEW — XML parser essential; Ubuntu Noble fix deferred for listed advisory |
| CVE-2025-66418 | `python3-pip` | MEDIUM | REMOVE — Ubuntu system pip; isolated runtime venv already has its hashed packages and pip itself was uninstalled |
| CVE-2025-66471 | `python3-pip` | MEDIUM | REMOVE — Ubuntu system pip; isolated runtime venv already has its hashed packages and pip itself was uninstalled |
| CVE-2025-70559 | `python3-pdfminer` | MEDIUM | REMOVE — Ubuntu system PDF parser, not a direct Odoo Debian dependency; pinned venv uses pypdf |
| CVE-2025-7425 | `libxslt1.1` | MEDIUM | REVIEW — upstream python3-lxml dependency; Noble security status requires independent patch/ABI review |
| CVE-2026-102473 | `dash` | MEDIUM | RETAIN — /bin/sh required by entrypoint and package scripts |
| CVE-2026-102474 | `dash` | MEDIUM | RETAIN — /bin/sh required by entrypoint and package scripts |
| CVE-2026-103111 | `libpcre2-8-0` | MEDIUM | REVIEW — transitive regex library; untrusted Unicode/JIT risk, needs Noble security update |
| CVE-2026-107161 | `libsasl2-2` | MEDIUM | RETAIN — TLS/LDAP/SASL transitive dependency |
| CVE-2026-107161 | `libsasl2-modules-db` | MEDIUM | RETAIN — SASL DB module transitive dependency |
| CVE-2026-1703 | `python3-pip` | LOW | REMOVE — Ubuntu system pip; isolated runtime venv already has its hashed packages and pip itself was uninstalled |
| CVE-2026-18374 | `libc-bin` | MEDIUM | RETAIN — glibc core toolchain |
| CVE-2026-18374 | `libc6` | MEDIUM | RETAIN — glibc core runtime; only verified Noble updates permitted |
| CVE-2026-18477 | `tar` | MEDIUM | RETAIN — dpkg infrastructure dependency |
| CVE-2026-18508 | `tar` | MEDIUM | RETAIN — dpkg infrastructure dependency |
| CVE-2026-21441 | `python3-pip` | MEDIUM | REMOVE — Ubuntu system pip; isolated runtime venv already has its hashed packages and pip itself was uninstalled |
| CVE-2026-22693 | `libharfbuzz0b` | LOW | RETAIN — font shaping dependency required for Arabic output |
| CVE-2026-24049 | `python3-wheel` | MEDIUM | REMOVE — Ubuntu system build-helper, required only by removed system pip; runtime has installed wheels |
| CVE-2026-40228 | `libsystemd0` | LOW | RETAIN — inherited system library; require independent pruning feasibility review |
| CVE-2026-40228 | `libudev1` | LOW | RETAIN — inherited system library; require independent pruning feasibility review |
| CVE-2026-48930 | `libnode109` | MEDIUM | REVIEW — runtime library for upstream Node.js 18; tied to RTL CSS tooling |
| CVE-2026-48930 | `nodejs` | MEDIUM | REVIEW — Ubuntu Node 18 used by the inherited RTL CSS / JS tooling; cannot replace without Arabic asset test |
| CVE-2026-67693 | `libgnutls30t64` | MEDIUM | REVIEW — upstream apt/LDAP TLS dependency; no verified Noble fixed build in scan |
| CVE-2026-86145 | `libpcre2-8-0` | MEDIUM | REVIEW — transitive regex library; untrusted Unicode/JIT risk, needs Noble security update |
| CVE-2026-86469 | `libglib2.0-0t64` | MEDIUM | RETAIN — GLib image/tooling dependency |
| CVE-2026-88647 | `libgnutls30t64` | MEDIUM | REVIEW — upstream apt/LDAP TLS dependency; no verified Noble fixed build in scan |
| CVE-2026-88648 | `libgnutls30t64` | MEDIUM | REVIEW — upstream apt/LDAP TLS dependency; no verified Noble fixed build in scan |
| CVE-2026-88807 | `libxrender1` | MEDIUM | REVIEW — wkhtmltox/X11 PDF rendering dependency; cannot remove without actual PDF regressions |
| CVE-2026-89092 | `libc-bin` | MEDIUM | RETAIN — glibc core toolchain |
| CVE-2026-89092 | `libc6` | MEDIUM | RETAIN — glibc core runtime; only verified Noble updates permitted |
| CVE-2026-89156 | `libpcre2-8-0` | MEDIUM | REVIEW — transitive regex library; untrusted Unicode/JIT risk, needs Noble security update |
| CVE-2026-89157 | `libpcre2-8-0` | MEDIUM | REVIEW — transitive regex library; untrusted Unicode/JIT risk, needs Noble security update |
| CVE-2026-89158 | `libpcre2-8-0` | MEDIUM | REVIEW — transitive regex library; untrusted Unicode/JIT risk, needs Noble security update |
| CVE-2026-89160 | `libpcre2-8-0` | MEDIUM | REVIEW — transitive regex library; untrusted Unicode/JIT risk, needs Noble security update |
| CVE-2026-89161 | `libpcre2-8-0` | MEDIUM | REVIEW — transitive regex library; untrusted Unicode/JIT risk, needs Noble security update |
| CVE-2026-95184 | `libgnutls30t64` | MEDIUM | REVIEW — upstream apt/LDAP TLS dependency; no verified Noble fixed build in scan |
| CVE-2026-95209 | `libgnutls30t64` | MEDIUM | REVIEW — upstream apt/LDAP TLS dependency; no verified Noble fixed build in scan |
| CVE-2026-95210 | `libgnutls30t64` | MEDIUM | REVIEW — upstream apt/LDAP TLS dependency; no verified Noble fixed build in scan |
