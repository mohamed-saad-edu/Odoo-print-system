# Windows GDI capability and transfer correction — 20 October 2026

## Status and scope

**IMPLEMENTED:** automatic raster-operation selection from the active Windows
printer DC, device-compatible bitmap preparation, and native failure diagnostics.
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
