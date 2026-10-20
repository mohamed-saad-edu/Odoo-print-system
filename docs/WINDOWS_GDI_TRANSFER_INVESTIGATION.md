# Windows GDI transfer investigation — 20 October 2026

## Status

**IMPLEMENTED / TESTED:** preserve native bitmap-transfer diagnostics and add real
Windows GDI regression coverage. **NOT VERIFIED:** the reason the customer's
installed drivers return zero. **HARDWARE VALIDATION NOT VERIFIED.** This change
is not a demonstrated repair of the customer's no-output failure.

Baseline: `b0a4d8b395dc421971e9c2361ea939c5507bda2f`. The earlier geometry PR #29
is already merged. This follow-up is PR #30; it does not change media selection,
DPI, raster format, fitting, transport, bindings, or reconciliation.

## Evidence and failing boundary

The supplied screenshots show successful progression through PDFium rendering,
printer-DC creation, `StartDocW`, and `StartPage`. The failure occurs in
`drawBitmapToPrinter` in `agent/internal/printer/pdf_windows.go`:

| Queue type | Rendered bitmap px | Destination origin px | Destination size px | API result |
| --- | --- | --- | --- | --- |
| POS80 | 640 × 828 | 0, 12677 | 640 × 828 | SetDIBitsToDevice = 0 |
| POS80 | 576 × 853 | 0, 0 | 576 × 853 | SetDIBitsToDevice = 0 |
| Canon office queue | 3516 × 4550 | 0, 100 | 4800 × 6211 | StretchDIBits = 0 |

The operator reports that none of these attempts produced paper. This observation
is evidence about these attempts; it does not justify changing the general
UNKNOWN policy after submission begins.

The screenshots do not supply selected paper forms, physical/printable page
bounds, DPI, hardware offsets, raster capability flags, driver versions, or the
running Agent executable identity. Those measurements remain **unknown**. A
bitmap width is not itself a paper-width or print-head measurement. The unusually
large first Y origin warrants checking the selected form and actual clip region;
it does not explain the other two failures by itself.

A missing printer, invalid PDF, or refusal before StartDoc does not match this
reported boundary. Driver format incompatibility, invalid actual clipping bounds,
per-job media substitution, and driver/resource failures remain hypotheses.
Neither successful virtual printing nor these screenshots distinguish them.

## Verified software defect and correction

Both native drawing callbacks discarded LazyProc.Call's last-error result. As a
result, the helper could report only an unconfirmed transfer with a zero return;
useful driver diagnostics were lost. This is a verified diagnostic defect, not a
verified cause of the physical printing failure.

- `pdf_windows.go` now forwards the native result and, only on failure, captures
  `GetClipBox` and the already queried `RASTERCAPS`. It makes no second drawing
  call and records no receipt pixels, document content, or credentials.
- `pdf_gdi.go` preserves native last-error numbers on unsuccessful transfers.
  It keeps the primary scan-line result authoritative: LazyProc.Call returns an
  Errno even on success. Zero diagnostic codes do not imply success, and nonzero
  diagnostic codes do not overturn a successful primary result. Preparation
  errors retain their existing identity.
- `pdf_gdi_test.go` covers native codes 0, 6, and 87, primary-result precedence,
  and one submission per call. Existing direct/stretched failure and preparation
  tests remain in place.
- `pdf_gdi_windows_test.go` calls actual GDI APIs with the three screenshot
  geometries and smaller direct/stretched examples, then checks memory-surface
  pixels. Additional cases exercise enhanced-metafile recording and invalid-DC
  diagnostics without opening a printer or submitting a job.

The diagnostic regression failed before the change (`native diagnostic lost`)
and passed afterward. The unchanged production drawing path passed the new
native memory-surface geometry tests on Windows in commit `93d04bd` (run
[39395957881](https://github.com/mohamed-saad-edu/Odoo-print-system/actions/runs/39395957881)).
This rules out a universal failure of those dimensions or Win32 struct layouts;
it does not rule out an installed printer-driver incompatibility.

## Research and selection

- [Microsoft SetDIBitsToDevice](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-setdibitstodevice)
  and [StretchDIBits](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-stretchdibits)
  document zero as failure or no transferred scan lines. Suppressing zero or
  replaying another drawing API after submission would lose outcome safety.
- [BITMAPINFO](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapinfo)
  documents the DIB representation. Negative height and uncompressed RGB are
  supported; the screenshots do not establish that 32-bit top-down data is the
  cause. A speculative conversion to 24-bit bottom-up data was not selected.
- [GetClipBox](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getclipbox)
  reports actual visible bounds in logical coordinates. Clip kind 0 means the
  query failed; kind 1 is empty; kind 2 is a rectangle; kind 3 is complex. A
  complex region's bounding rectangle alone does not prove full visibility.
- [GetDeviceCaps](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getdevicecaps)
  distinguishes printable bounds, physical bounds, offsets and raster operations.
  RC_DIBTODEV and RC_STRETCHDIB advertise different operations, not proof of
  output. Existing API selection is preserved pending actual driver evidence.
- [GetLastError](https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-getlasterror)
  warns that last-error information is not always specified by an API. The new
  number is explicitly diagnostic, never used to infer physical success or retry.
  [Go LazyProc.Call](https://pkg.go.dev/golang.org/x/sys/windows#LazyProc.Call)
  requires inspecting the primary return before its always non-nil error.
- [PDFium's Windows GDI source](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/core/fxge/win32/cgdi_device_driver.cpp)
  uses top-down BI_RGB DIBs and the same drawing APIs. This supports testing the
  current representation before replacing it; its return-handling policy is not
  copied into a receipt pipeline that must preserve unknown physical outcomes.

No third-party code or new dependency was copied or installed.

## Compatibility and next required evidence

The change affects diagnostic reporting for Windows document/image printing,
including Windows-queue-backed USB and network printers, thermal 58/80mm, office
A4/Letter, POS, kitchen and ordinary PDFs. It does not change their layout or
submission policy. Direct ESC/POS, RAW TCP, native USB bytes, IPP/IPPS and label
languages do not use this GDI path and are unchanged. Job identities, ambiguity,
cancellation, tenant isolation and duplicate protections remain intact.

Before choosing a rendering change, obtain the exact service executable path and
version, queue driver/version, and one controlled attempt's `Embedded PDF print`
line plus its new error containing `win32_last_error`, `raster_caps`, `clip_kind`
and `clip`. Review physical output and the original queue job before any operator
resubmission. Do not replay old UNKNOWN jobs automatically or change global
printer preferences to gather this evidence.

Deploying the diagnostic change requires a new Windows Agent binary; no Gateway
or Odoo update and no driver configuration change is required. Use the supported
installer/upgrade flow for an isolated pilot, identify the service's actual
executable, and retain the previous installer for rollback. This PR is not a
claim of a production printing fix and has not been deployed to the customer.

## Verification evidence

| Check | Result |
| --- | --- |
| Diagnostic regression on original helper | FAIL: native code/API context lost, saved in `red-native-diagnostic.log` |
| Focused GDI regressions after correction | PASS |
| `cd agent && go test -mod=readonly -race -vet=all -json ./...` | PASS: 1,464 test events passed, 2 skipped, 0 failed |
| Native Windows original renderer with exact reported bitmap sizes | PASS: run 39395957881, commit 93d04bd |
| Corrected native Windows suite, including metafile/failure cases | See PR #30 checks and local follow-up evidence; requires native execution |
| Customer drivers and physical paper output | NOT VERIFIED |

Local follow-up logs are in `.audit/gdi-transfer-20261020/` (ignored). They include
baseline native CI output, before/after diagnostic regression output and the full
Go JSON test stream. No customer receipt payload was saved for this follow-up.
