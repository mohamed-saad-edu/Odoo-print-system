# Receipt geometry correction — 2026-10-19

## Status and scope

**IMPLEMENTED / TESTED / WINDOWS CROSS-BUILD VERIFIED.** Native Windows CI
results belong to the change's PR checks. **HARDWARE VALIDATION NOT VERIFIED.**
No deployment, physical submission, driver preference change, registry edit,
firmware change, or customer queue access was performed.
Investigation began on 2026-10-19; final local software checks completed on 2026-10-20.

Baseline: `11bb3edd6a037bc0f49094a4bb1befe07396dd35`, repository
`mohamed-saad-edu/Odoo-print-system`. The working tree was clean. The open
staging PR #27 was unrelated and was not modified. Graphify's existing
8,587-node graph located printing code; current source established behavior.

The reported TA-900U's actual backend, driver/version, form, device caps,
installed Agent version, source receipt, and physical head limit were not
available. The supplied 80mm roll / 72mm head / 576-dot specification is
customer-reported, not an independently measured installed-device profile.
The software defects below are reproduced; they do **not** establish the
first clipping stage of that particular customer's receipt.

## Reproduced root causes

1. `spoolerDetectedReceiptPaper` recognized only forms within 2mm of 58/80mm,
   rounded those measurements to nominal roll sizes, discarded other positive
   DPI values, and rejected printable widths above the direct ESC/POS 576-dot
   software limit. A valid 70mm Windows form therefore selected generic
   96-DPI image geometry. The first incorrect geometry is at the driver-cap
   interpretation / JPEG-to-PDF boundary, before transport.
2. `desiredPrinterConfig`, `receiptPaperProfile` and `JPEGToPDFReceipt` accepted only 180/203 DPI.
   Reported 200/204/300 DPI was dropped or replaced with a guess. A 512-dot,
   300-DPI image became 204.80pt wide instead of 122.88pt (66.7% too wide).
3. Receipt detection did not check whether printable width plus horizontal
   offset exceeded the physical form. Final GDI validation already rejected
   impossible bounds, but receipt detection could misclassify them first.

The original converter regression failed at 200, 204, and 300 DPI. A pure
extraction of the original detector policy reproduced rejection of 70mm,
loss of exact form widths, rejection of 300/600-DPI widths, and acceptance of
an invalid negative offset. The corrected tests pass.

The current baseline already used `pdfPrintableDestination` to shrink and
center complete PDF pages within `HORZRES`/`VERTRES`, using separate axis DPI.
It did not deliberately crop PDF edges. Consequently, transport interruption,
Odoo custom-template overflow, a stale Agent, driver misreporting, and hardware
limits cannot be ruled out for the incident. They were not patched without
evidence. No source data loss was found in the synthetic capture/payload test.

## Traced execution boundaries

| Stage | Existing responsibility and evidence |
|---|---|
| POS receipt, reprint, kitchen and sale details | `pos_print_router.js`, `pos_sale_details_router.js`, and `receipt_raster.js` mount the receipt, load images/fonts, select a bounded width, reject horizontal overflow, then capture JPEG. `receipt_raster.css` reflows before capture. All fallback captures retain geometry checks. |
| Authorized binding | `pos_order.py`, `pos_session.py`, and `print_router.py::_receipt_width_for_route` obtain width through the same validated company/branch/Agent/printer target used for dispatch. |
| Gateway capabilities and payload | `api/odoo/printers/route.ts`, `receipt-width.ts`, `printer-model.ts`, and `print-job-service.ts` normalize bounded metadata, validate payloads, and retain tenant/binding/idempotency rules. Source review found no image resizing here. |
| Agent input | `payload.Parse` base64-decodes JPEG without resizing. The synthetic source survived Gateway validation and Agent parsing byte-for-byte. |
| Backend | `factory.go` normalizes Windows-queue-backed USB to Spooler. `SpoolerPrinter.PrintDocument` wraps images as PDF; embedded PDFium renders to GDI. Direct ESC/POS TCP converts images to bounded, banded rasters. Direct USB accepts declared byte languages, not arbitrary JPEG. IPP/PWG/JPEG conversion has its own format/geometry negotiation. |
| Driver and output | Per-job `DEVMODEW` is merged using `DocumentPropertiesW`, then actual DC caps are checked before `StartDocW`. Rejected forms fall back before submission; invalid geometry remains an error. Job IDs and UNKNOWN outcomes survive post-submission failures. Physical behavior remains unverified. |

## Research and selected approach

| Approach | Mechanism | Advantages | Risks | Selection |
|---|---|---|---|---|
| Driver-managed media fitting | Per-job DEVMODE, actual DC caps, proportional GDI destination | Uses installed queue and supported forms; office documents remain supported | Drivers can substitute forms or report misleading values; blocking calls require bounds | Retain existing fitting; correct its receipt input geometry |
| Capability-driven raster sizing | Preserve actual printable dots and DPI separately from form mm | Correct units; handles resolution/model differences | Roll width and DPI alone do not prove head width | Use exact driver observations for Windows documents; retain independent native-raster policy |
| Receipt-layout reflow | Mounted browser layout at target canvas width | Wraps long names; keeps amounts and Arabic shaping before rasterization | Custom fixed-width/hidden-overflow templates need separate investigation | Retain existing measured renderer; no speculative CSS changes |
| Direct ESC/POS raster | Bounded monochrome bands with width in bytes and height in dots | Existing low-buffer support; no Windows driver dependency | Command/model differences and head limits; unknown paper outcome after writes | Retain existing command/transport; verify complete boundary marks across bands |
| Explicit device profile | Existing operator paper/dots/DPI configuration | Supports independently verified devices and preserves old settings | Stale/conflicting profiles; estimates can be mistaken for measurements | Preserve overrides; retain positive configured DPI; no migration or silent rewriting |

Authoritative references, reviewed on 2026-10-19:

- [Microsoft GetDeviceCaps](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getdevicecaps): physical page, printable area, offsets and axis resolution are separate quantities. Our inference: a narrow form should retain its measured width rather than be rounded to a roll class.
- [DEVMODEW](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-devmodew) and [DocumentProperties](https://learn.microsoft.com/en-us/windows/win32/printdocs/documentproperties): dimensions use tenths of a millimeter; preserve driver-private bytes and merge per-job settings. Global defaults need not change.
- [CreateDCW](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-createdcw), [StartDocW](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-startdocw), [StartPage](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-startpage), and [StretchDIBits](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-stretchdibits): validate actual contexts after driver negotiation; change media between pages; a job identifier is submission evidence, not paper proof. Existing service-safe PDFium stream configuration and UNKNOWN handling remain intact.
- [Epson GS v 0](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lv_0.html): horizontal size is bytes, vertical size is dots, and over-wide data can be discarded. Epson recommends newer graphics functions for compatible models; this does not prove TA-900U support, so the command was not replaced.
- [Star printable-area setting](https://star-m.jp/products/s_print/sdk/starxpand/manual/en/android-kotlin-api-reference/stario10-star-xpand-command/document-builder/setting-printable-area.html), [model-specific page areas](https://star-m.jp/products/s_print/sdk/starxpand/manual/en/ios-swift-api-reference/star-xpand-command/printer/page-mode-area-parameter/index.html), and [image parameters](https://star-m.jp/products/s_print/sdk/starxpand/manual/en/android-kotlin-api-reference/stario10-star-xpand-command/printer/image-parameter/index.html): SDKs distinguish millimeter areas from image-dot widths and impose model-specific limits. Adding a Star SDK would not repair a Windows GDI unit error.
- [Odoo 19 receipt printers](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/configuration/epos_printers.html) distinguishes direct ePOS and IoT-supported ESC/POS connections. [Native renderer](https://github.com/odoo/odoo/blob/19.0/addons/point_of_sale/static/src/app/services/render_service.js), [image exporter](https://github.com/odoo/odoo/blob/19.0/addons/point_of_sale/static/src/app/utils/html-to-image.js), and [receipt template](https://github.com/odoo/odoo/blob/19.0/addons/point_of_sale/static/src/app/screens/receipt_screen/receipt/order_receipt.xml) were read; their mounted canvas pipeline is retained.
- [OpenPrinting/CUPS options](https://openprinting.github.io/cups/doc/options.html) treats selected media and fit-to-page as separate settings. [python-escpos usage](https://python-escpos.readthedocs.io/en/latest/user/usage.html) likewise requires actual transport/device parameters. Neither justifies guessing a protocol from USB or a model name.

No third-party implementation code or new dependency was added. The chosen
change corrects measured geometry in the existing Windows path; it adds no
printer database model, protocol, retry strategy, or alternative renderer.

## Changed files and compatibility

| File | Before → after; verification |
|---|---|
| `agent/internal/agent/desired_state.go`, `desired_state_test.go` | Windows desired-state profiles lost positive DPI and widths above 576 dots before reaching the factory → preserve bounded driver geometry for normalized Windows queues, including USB queues. Eight cases retain native TCP/USB limits and reject invalid metadata. No wire fields or Gateway schema changed. |
| `agent/internal/printer/spooler_receipt.go` (new) | Testable detector policy preserves measured mm/dots/DPI and checks horizontal bounds. Automatic narrow-form policy is 40–120mm; this is a classification range, not a firmware limit. |
| `spooler_receipt_windows.go` | Nominal 58/80mm classification and 576-dot filter → exact driver geometry including offset, within the existing bounded preflight. |
| `spooler_windows.go` | Unrecognized 70mm forms used 96-DPI wrapping → detected forms use receipt wrapping. Existing explicit 58/80mm profiles retain their path; office/unknown media keep generic sizing. |
| `image.go` | Positive non-180/203 DPI was guessed → positive DPI retained. Internal form width accepts fractional mm and validates finite geometry. JPEG embedding, aspect ratio, margins and resource limits remain intact. |
| `factory.go` | Dropped configured DPI outside 180/203 and printable widths above 576 dots → retains positive explicit DPI (including `dpi`) and bounded Windows widths up to 16,384 dots. Missing-DPI legacy estimates remain estimates; larger profiles require explicit DPI. |
| `pdf_windows.go` | Existing geometry log now includes PDF source size, printable dimensions, and axis DPI as well as physical form, offsets and fitted bounds; no receipt text or payload is logged. |
| `spooler_receipt_test.go` | Nine driver profiles through detection, real fixture conversion, unchanged JPEG embedding and final printable bounds; invalid/office geometry cases. |
| `thermal_receipt_geometry_test.go`, `pdf_fit_test.go` | Positive-DPI and configuration regressions; 70mm form/printable cases and unusual narrow forms added to existing tests. |
| `raster_capability_test.go` | Real long receipt retains both left/right top/bottom registration marks across bands at eight target widths. |
| `tests/fixtures/receipt-geometry.html`, `testdata/receipt-geometry.jpg`, `testdata/receipt-geometry.md` | Synthetic bilingual receipt and reproducible capture provenance; no customer data. |
| `PRINTERS.md`, this document | Correct backend-specific geometry/default documentation, evidence, limitations and rollout. |

Paths without a prefix in this table are under `agent/internal/printer/`, except `desired_state_test.go`, which is beside `desired_state.go`.

58mm/80mm driver documents benefit from preserved measurements. A4, Letter,
landscape, multipage PDFs, ordinary PDF input, IPP/IPPS, RAW TCP, direct USB,
ZPL/TSPL, tenant authorization, bindings, queue durability and reconciliation
have no production logic change. POS/kitchen/reprint image jobs benefit when
their resolved backend is a Windows queue. Direct ESC/POS limits and nearest
neighbor resampling are retained and regression-tested; no additional
resampling was introduced. End-to-end hardware compatibility is not asserted.

## Recorded digital geometry

All driver tuples below are **synthetic regression inputs**, not TA-900U
measurements. Nominal roll width is a test-case label; driver form comes from
`physicalPixels × 25.4 / DPI`. The source is 512 × 2852 pixels, SHA-256
`e70de58555afa0665c1f727619d5b23280d3b3767f0b4cd35cad8873c2252a34`.
Gateway validation and Agent parsing preserve that exact hash.

| Test case | Driver form mm | Printable dots | DPI | X/Y offset px | Converted PDF pt | Final GDI destination px |
|---|---:|---:|---:|---|---|---|
| 58mm / 180 | 57.99667 | 360 | 180 | 20 / 12 | 164.40 × 813.46 | (0,114) 360 × 1781 |
| 58mm / 203 | 58.05714 | 384 | 203 | 40 / 12 | 164.57 × 770.00 | (0,175) 384 × 1796 |
| 80mm / 180 | 80.01000 | 512 | 180 | 20 / 12 | 226.80 × 1152.14 | (0,128) 512 × 2600 |
| 80mm / ~72mm printable | 80.07882 | 576 | 203 | 32 / 12 | 227.00 × 1149.33 | (0,150) 576 × 2916 |
| 80mm roll / ~70mm form | 70.06897 | 552 | 203 | 4 / 12 | 198.62 × 1054.56 | (0,10) 552 × 2930 |
| 80mm / ~70mm printable | 80.07882 | 560 | 203 | 40 / 12 | 227.00 × 1117.72 | (0,185) 560 × 2757 |
| Unusual form | 75.94600 | 560 | 200 | 12 / 12 | 215.28 × 1134.31 | (0,88) 560 × 2950 |
| 80mm / 300 | 80.01000 | 850 | 300 | 40 / 12 | 226.80 × 1147.68 | (0,228) 850 × 4301 |
| 80mm / 600 | 80.01000 | 1700 | 600 | 80 / 12 | 226.80 × 1147.68 | (0,469) 1700 × 8602 |

The old generic 70mm fallback produced a 384 × 2139pt PDF
(135.47 × 754.59mm) from the same image. The new 70mm case retains the
70.06897mm form. The synthetic form height is derived from the converted
page; a real driver's accepted length remains a hardware validation gate.
The existing whole-page fit can further shrink margins/content together;
there is no claim of one source pixel per final physical dot.

Browser captures at 288/360/384/420/512/552/560/576px were respectively
6635/4529/4066/3532/2852/2603/2532/2425px high. Complete Arabic/English text,
12 items, totals and both registration marks were visible digitally. An additional
digital check matched all 1,089 module/quiet-zone centers against the generated QR
symbol in the source JPEG, eight decoded ESC/POS rasters, and the 70mm PDF preview,
with zero mismatches. This is symbol preservation evidence; independent scanner
readability after physical printing is not verified.

## Verification and remaining gates

Executed locally with Go 1.26.9 / Node 24.21.0:

```sh
# Expected red results, then corrected focused regressions:
cd agent
go test -mod=readonly ./internal/printer -run 'TestReceiptPaper|TestThermalReceiptPDFPreservesReportedDPI' -count=1
go test -mod=readonly -race -vet=all ./internal/printer -run 'TestReceipt|TestThermalReceipt|TestSpoolerProfile|TestPDFFit' -count=1
go test -mod=readonly -race -vet=all ./internal/agent -run 'TestDesiredStatePreservesDriverGeometry|TestDesiredStatePassesExplicit80mm' -count=1
go test -mod=readonly -race -vet=all ./...
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -mod=readonly ./...
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go test -mod=readonly -c ./internal/printer -o /tmp/printer-windows.test.exe
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go vet -mod=readonly ./...
cd ..
npm test -- tests/receipt-width.test.ts tests/pos-receipt-font.test.ts tests/e2e-capture-admission.test.ts tests/diagnostic-payload-parity.test.ts tests/job-diagnostic-payload.test.ts
python3 -m pytest -q tests/test_odoo19_printing_static.py tests/test_pos_receipt_font_rendering.py tests/test_agent_print_diagnostic_media.py
```

Full Go suite: **1,455 passed, 2 skipped**, ten packages; focused final receipt
suite: **38 passed**, desired-state handoff: **10 passed**. Gateway/POS: **37 passed**. Odoo static: **140 passed**
(existing Python deprecation warnings). Windows build, printer-test binary
compilation and vet passed. Browser capture and payload hash checks passed.
An isolated artifact capture generated PDFs and ESC/POS streams without
submitting a job; Poppler opened the 70mm result as a complete single page.
Temporary capture code was removed from the printer package.

Local evidence is retained under `.audit/print-geometry-20261019/`:
red/green/full-suite JSON logs, converted PDFs, decoded raster PNGs, original
captures, Gateway payload, and an artifact SHA-256 manifest. This ignored
directory contains synthetic data only and is not part of the shipped Agent.

Existing tests cover document fitting, rejected/substituted forms, invalid
DPI, impossible geometry, unavailable printers, partial writes, cancellation,
timeouts, UNKNOWN outcomes, admission and idempotency. Cross-compilation does
not execute Windows-only driver tests. Live Odoo OWL rendering, PostgreSQL
delivery, the installed Windows driver, actual paper length/cut/feed,
machine scanning, and controlled before/after paper comparison remain
**NOT VERIFIED** here. A mock transport or a successful spooler job does not
close those gates.

Geometry resolution remains constant-time with no raster allocation. JPEG
and PDF resource bounds are unchanged. No dependency, DB migration, network
round trip, retry or queue reconciliation behavior was added. Performance
against a real Windows driver and physical printer is not benchmarked.

## Deployment and rollback

This requires a **new Windows Agent binary**. No Gateway deployment, Odoo
addon update, database migration, or automatic driver adjustment is required.
Preserve existing configuration and pending-job storage.

1. Require green relevant PR/Windows CI checks. Record the built artifact's
   commit and SHA-256; retain the previous binary and service configuration.
2. Select one controlled pilot queue. Record its actual backend, driver name
   and version, selected form, print processor/datatype and port. Use
   `yaseir-agent-cli.exe diagnose printers --json` for read-only queue evidence;
   the new per-job geometry log supplies actual DC dimensions/DPI/offsets.
   Compare these with the installed device's own specification/self-test.
3. Let active jobs settle before replacing the binary through the normal
   service/installer procedure. Do not clear queue storage, change bindings,
   globally force 80mm, or replace unresolved UNKNOWN attempts.
4. Submit one synthetic controlled test under a new explicit operation ID.
   Retain source/payload hashes and geometry log. Compare with the same
   baseline payload, checking all product names/amounts/taxes, both edges,
   Arabic/English, QR scan, length, margins, cut/feed and absence of duplicates.
   Obtain a separate inspection result; submission is not confirmation.
5. If output remains wrong, stop the pilot and collect the first failing
   stage. Any intentional repeat requires reconciliation/inspection of the
   prior attempt. Driver adjustment, if evidence requires it, is a separate
   operator action after recording the original settings.
6. Roll back by settling active jobs and restoring the retained Agent binary,
   with the same config and durable queue. No data/schema rollback is needed.
   Reconcile unresolved attempts before permitting any deliberate reprint.
