# Windows GDI capability and transfer correction — 20 October 2026

## Status and scope

**IMPLEMENTED:** automatic raster-operation selection from the active Windows
printer DC, device-compatible bitmap preparation, native failure diagnostics,
and current-media fitting for valid PDFs outside Windows form-size limits.
**TESTED:** focused capability/diagnostic tests and the full local Go suite.
Native Windows results are recorded in PR #30 checks and local verification logs.
**HARDWARE VALIDATION NOT VERIFIED:** the exact reason the customer's installed
drivers returned zero has not been independently established.

Base: `b0a4d8b395dc421971e9c2361ea939c5507bda2f`. Earlier geometry PR #29 is
merged. This follow-up, PR #30, uses those actual media/DPI/offset measurements;
it adds no printer-model rule, manual width choice, new dependency, configuration
field, global Windows preference change, or transport substitution.

## Incident evidence and verified defects

The screenshots reach `StartDocW` and `StartPage`, then fail in the bitmap drawing
stage of `agent/internal/printer/pdf_windows.go`:

| Queue type | Rendered bitmap px | Destination origin px | Destination size px | API result |
| --- | --- | --- | --- | --- |
| POS80 | 640 × 828 | 0, 12677 | 640 × 828 | SetDIBitsToDevice = 0 |
| POS80 | 576 × 853 | 0, 0 | 576 × 853 | SetDIBitsToDevice = 0 |
| Canon office queue | 3516 × 4550 | 0, 100 | 4800 × 6211 | StretchDIBits = 0 |

The operator reports no paper emerged. The screenshots do not contain paper
form, nominal/printable widths in mm, DPI, physical bounds/offsets, raster flags,
driver versions, or installed executable identity. Those values remain unknown;
a bitmap width is not itself a paper or print-head measurement. The large first
Y origin warrants checking the selected long form; it cannot explain both other
failures by itself. Missing-printer, invalid-PDF and pre-StartDoc refusal do not
match the observed boundary. Driver format rejection remains a hypothesis.

Two source defects were verified:

1. Raster selection queried only RC_DIBTODEV. Resizing, or absence of that flag,
   unconditionally selected StretchDIBits without checking RC_STRETCHDIB. Devices
   advertising memory-bitmap transfers had no corresponding supported path.
2. Both DIB drawing callbacks discarded the native last-error result, preventing
   failures from retaining useful Windows diagnostics.

The original rendering implementation passed real Windows memory-surface pixel
checks at all three reported sizes in commit `93d04bd`, run
[39395957881](https://github.com/mohamed-saad-edu/Odoo-print-system/actions/runs/39395957881).
That rules out a universal failure of those dimensions/Win32 struct layouts;
it does not reproduce or explain an installed printer driver's rejection.

## Automatic behavior

The existing flow negotiates per-job DEVMODE, queries the actual printer DC for
physical bounds, printable bounds, X/Y DPI and offsets, then proportionally fits
the full document and bounds rendering to 16 million pixels. The correction adds
operation negotiation at that same Windows backend boundary:

| Advertised operations | Selected rendering |
| --- | --- |
| DIB-to-memory plus BitBlt/StretchBlt suitable for the destination | Create a bitmap compatible with the actual printer DC, populate all scan lines using SetDIBits, then submit once using BitBlt or StretchBlt |
| DIB-to-device, same-size destination | Existing SetDIBitsToDevice path |
| StretchDIBits, including a same-size destination when direct copy is absent | Existing StretchDIBits path |
| Compatible bitmap preparation fails, but the required DIB operation is advertised | Release the memory-only preparation and select DIB before any printer drawing |
| No suitable advertised operation | Clear preparation error before StartDoc for the first page |

CreateCompatibleBitmap uses the printer DC, not a default screen/monochrome DC,
so Windows supplies the device's color representation. SetDIBits is called before
selecting the new bitmap into its memory DC and must populate the complete height.
It does not draw onto the printer. The first page is fully prepared before
admission/StartDoc; later pages prepare after any ResetDC and before StartPage.
Only one physical drawing call is made per page. A failed drawing is never
replayed through another API. Errors after StartDoc remain UNKNOWN, including
later-page preparation failures. Existing job identity, cancellation, ownership,
queue durability and reconciliation remain in force.

Source aspect and destination geometry are preserved. This does not force 58mm,
80mm, 512/576 dots, a particular printer DPI, a new paper form or a printer-native
protocol. Conversion does not crop or reflow the existing raster. Native memory
is held for one page and released on preparation failure, admission refusal,
StartDoc failure, page failure and successful completion. Native preparation adds
one bounded bitmap copy (standard GDI bitmap storage is at most 32 bits/pixel)
and no Gateway round trip. It never creates a full-document raster cache.

## Changed files and checks

| File | Previous behavior / correction | Verification |
| --- | --- | --- |
| `agent/internal/printer/pdf_gdi.go` | One direct-DIB flag; now resolves compatible/DIB operations separately and preserves native failure codes | Capability matrix, success-result precedence, signed scan lines, no retry |
| `agent/internal/printer/pdf_bitmap_windows.go` | New Windows-only preparation using existing GDI/cleanup conventions; compatible memory conversion, safe preparation fallback, one drawing call | Native color/monochrome pixel tests, source-buffer ownership, invalid-device/size rejection |
| `agent/internal/printer/pdf_windows.go` | Drew a DIB after StartPage; now prepares the page first and releases its native resources on every normal/error branch | Full native Windows suite; existing job-ID/cancellation/outcome regressions; cross-compilation/vet |
| `agent/internal/printer/pdf_gdi_test.go` | Extends existing regression tests with supported/unsupported raster combinations and diagnostic codes 0/6/87 | Local focused Go tests |
| `agent/internal/printer/pdf_gdi_windows_test.go` | Previously no actual GDI pixel checks; adds both legacy and automatic paths at reported sizes, monochrome conversion, metafile recording and invalid input | Native Windows CI, no printer job submitted |
| `tests/architectural-constraints-and-statuses.test.ts` | Follow the shared HALFTONE helper after its move, retain brush-origin/error assertions, and require both DIB and compatible stretch callers to use it | Focused Gateway/receipt suite: 33 passed |
| This report | Records evidence, boundaries, references and rollout impact | Diff reviewed; no customer screenshot or job identity committed |

The diagnostic regression failed before correction (`native diagnostic lost`) and
passes afterward. Capability tests cover direct-only, stretch-only, native-only,
mixed and missing operations, including stretch-only at equal size. Native tests
clear the source buffer after compatible preparation and verify transferred
pixels: successful preparation must own the converted image independently.

Commands: `cd agent && go test -mod=readonly -race -vet=all -json ./...`, focused
`go test -mod=readonly ./internal/printer -run '^TestGDIBitmap' -count=1`, Windows
printer-package cross-compilation and Windows-targeted `go vet`. Final results and
native run identities are retained in `.audit/gdi-transfer-20261020/` (ignored)
and the PR checks. Unrelated Gateway/Odoo source is unchanged.

The production correction at `53f7a7f` passed the complete native Windows suite in
[run 39399209518](https://github.com/mohamed-saad-edu/Odoo-print-system/actions/runs/39399209518),
and the native `-race -vet=all` stage of installer run 39399253351. Local final
coverage is 1,476 passed test events, two skipped, across ten passing packages.
The first broad Gateway CI run found a source-location assumption in the
HALFTONE contract test; that test now follows the shared helper and verifies both
callers. The correction retains its assertions. Native test data generation now
copies repeated rows instead of instrumenting millions of per-pixel assignments;
the dimensions, colors and output/ownership assertions are unchanged.

## Research and trade-offs

- [Microsoft GetDeviceCaps](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getdevicecaps)
  distinguishes physical/printable dimensions, offsets and raster operations.
  Its flags are operation capabilities, not proof of physical output. Driver
  reports can be wrong; actual preparation errors and outcome uncertainty remain
  authoritative. No guessed width is promoted to a verified capability.
- [CreateCompatibleDC](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-createcompatibledc)
  and [CreateCompatibleBitmap](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-createcompatiblebitmap)
  provide a device-compatible memory surface. This trades one bitmap copy for
  Windows-managed color-format conversion instead of a guessed printer format.
  The production path uses the printer HDC and needs no interactive display DC.
- [SetDIBits](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-setdibits)
  initializes a compatible bitmap; its target must not yet be selected into a DC.
  Complete scan-line preparation is checked before any printer drawing.
- [BitBlt](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-bitblt)
  and [StretchBlt](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-stretchblt)
  require operation support and compatible device contexts. Both source memory DC
  and bitmap derive from the destination printer DC. Existing proportional
  destination bounds and HALFTONE scaling remain in use.
- [SetDIBitsToDevice](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-setdibitstodevice)
  and [StretchDIBits](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-stretchdibits)
  return zero for failure or no transferred scan lines. These supported paths
  remain available, but a zero physical drawing result is never suppressed.
- [StartPage](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-startpage)
  preserves DC attributes; ResetDC resets them and is used only at page boundaries.
- [GetClipBox](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getclipbox)
  supplies actual visible logical bounds on failure. Kind 0 means query failure,
  1 empty, 2 a rectangle, 3 complex. A complex bounding box is not proof of full
  content visibility.
- [GetLastError](https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-getlasterror)
  explains why extended errors are diagnostics, not physical-output evidence.
  Successful primary results are not overturned by a non-nil native Errno.
- [PDFium's GDI implementation](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/core/fxge/win32/cgdi_device_driver.cpp)
  uses top-down BI_RGB DIBs. Those are not universally invalid. We retain that
  supported route and do not copy its return-ignoring policy into this pipeline.

The earlier [geometry report](RECEIPT_GEOMETRY_RELIABILITY.md) covers Microsoft,
Epson, Star, Odoo and other printing approaches across all backends. No vendor SDK,
third-party source or new dependency was copied or installed for this correction.

## Follow-up: document size is not a Windows paper-form constraint

Further review found a separate, reproducible source-size rejection:
`pdfPaperForPoints` correctly rejects dimensions that cannot be encoded as a
Windows form, but both planning and `pdfPrintableDestination` treated that as an
invalid PDF. Valid long or large pages were rejected before reaching the existing
current-media fallback. This is a verified software boundary defect, not an
established explanation of the customer's post-StartDoc bitmap failures.

[Microsoft DEVMODEW](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-devmodew)
defines paper width/length as signed shorts in tenths of a millimeter. That limits
the requested form to 3276.7mm per side; it does not impose the same constraint on
an application's source document. Source dimensions now undergo their own finite,
positive validation. If form conversion fails, planning uses the same validated
current-media fallback as a driver-rejected form, before StartDoc. Zero-valued
`pdfPaper` caches that current mode; no zero form is submitted to Windows.

The shared printable-area calculation accepts valid sources independently of
form encoding. It normalizes the source before DPI conversion to avoid numeric
overflow, then applies the existing shrink-only proportional fit. Rendering
buffers remain limited by the existing pixel budget. Invalid source dimensions,
impossible driver bounds/offsets, missing DPI, substituted copies/scaling and all
physical-outcome protections continue to reject unsafe submission.

Changed files: `pdf_geometry.go` separates source validation and form encoding;
`pdf_windows.go` allows unrepresentable forms to use current media;
`pdf_fit_test.go` extends proportional-fit regressions and rejects non-finite or
non-positive dimensions on either axis. Existing standard forms, mixed-page mode
caching, native protocols and all Gateway/Odoo producers remain unchanged.

Before correction the three added fit fixtures failed with
`PDF page size exceeds Windows paper dimension limits`. Tests now cover a 4m-long
receipt, a 12000×10000pt page, a page below form precision, and finite numeric
extremes. These are synthetic software inputs, not printer measurements. Fitting
an oversized page onto smaller media can make text/QR symbols too small; retained
content and proportional bounds do not establish physical legibility. Arbitrary
printer/driver failures cannot safely be turned into reported success.

Local follow-up validation: full Go `-race -vet=all` suite, 1,480 passing test
events, two skips and ten passing packages; focused Gateway/receipt tests, 33
passed; Windows printer-package cross-compilation and vet passed. Red/green
fixture logs and full-suite output are retained under the existing ignored audit
directory. Native Windows CI and the updated installer are tracked on PR #30;
installer 39399253351 predates this source/form follow-up.

## Compatibility, rollout and remaining verification

Windows-queue-backed USB/network printers, thermal 58/80mm and unusual narrow
forms, office A4/Letter, POS, kitchen, images and ordinary/multipage PDFs share
this automatic driver-based selection. Physical forms, DPI and offsets remain
separate. Direct ESC/POS, RAW TCP, native USB bytes, IPP/IPPS and ZPL/TSPL byte
protocols are unchanged; they retain their own negotiated capabilities.

Deployment requires a new Windows Agent binary only. Gateway/Odoo upgrades and
manual paper-width/DPI changes are not required by this change. Use the supported
installer/upgrade flow for a controlled pilot; retain the previous installer for
rollback and verify the service's actual executable/hash against the build.
Neither installation nor customer settings were changed automatically.

**NOT VERIFIED:** affected installed drivers, physical clipping/no-output repair,
printed Arabic/English readability, QR scanning, cut length and actual throughput.
The exact physical incident remains open until controlled hardware evidence is
available. Do not replay old UNKNOWN jobs automatically, including after rollback.
