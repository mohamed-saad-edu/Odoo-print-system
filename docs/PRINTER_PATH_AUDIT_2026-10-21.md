# Agent printer-path review - 21 October 2026

Baseline: `f0536a2bdbc7bdf6a1fe762095bc688ecd72bb90`.
Scope: confirmed software defects in printer transport, rendering, status and
release validation, preserving the existing architecture and security policy.
This is a targeted source review across repository components, not a claim that
every line in every repository file or every physical printer has been certified.

## Confirmed findings and corrections

| ID | Severity | Location | Reproduction / previous result | Correction and verification |
| --- | --- | --- | --- | --- |
| PRINT-01 | Major | `agent/internal/printer/pdf_windows.go:renderPageWithContext` | Cancel while rendering; let the renderer return after the cancellation branch's nonblocking channel drain. The result's cleanup callback is never called. A result returned with an error also loses cleanup. | Unbuffered ownership handoff in `pdf_render_wait.go`; the producer releases abandoned results, while successful callers own cleanup. A barrier prevents cleanup racing Kill. Six deterministic/race tests include late completion, cancellation, successful ownership and error cleanup. |
| PRINT-02 | Major | `agent/internal/printer/ipp.go:interpretIPPPrinterStatus` | An idle accepting printer reporting `media-empty-warning` or `offline-report` is classified as error/offline even though the suffix is explicitly nonblocking. | Respect explicit report/warning severity; keep true stopped/rejecting/error conditions blocked and preserve all original diagnostic reasons. Unknown vendor `-error` cannot become ready. Thirteen reason/state regressions; the old `offline-report` expectation is corrected rather than deleting fault coverage. |
| PRINT-03 | Major | `agent/internal/printer/ipp.go:normalizeIPPURL` | Bare `fd12:3456::10` becomes an unbracketed HTTP authority that cannot split correctly into host and port. | Use `net.JoinHostPort`; six IPv4/IPv6/default-port/IPPS cases. Does not relax endpoint authorization or disable TLS. |
| PRINT-04 | Major | `agent/internal/printer/ipp_formats.go:printPDFWithFormatNegotiation` | A device advertises PWG Raster and JPEG but a locally unsupported PWG variant causes immediate refusal, despite a viable advertised single-page JPEG representation. | Try only advertised representations during local preparation; preserve PWG preference, cancellation and all preparation failures. Send exactly one Print-Job after preparation. Six portable tests and native Windows PDFium/HTTP integration tests verify one probe/one submission and no redirect replay. |
| PRINT-05 | Major | `agent/internal/printer/pdf_windows.go:renderBounds` | Input 1 x 2,000,000,000 produced 1 x 178,885,438 after square-root scaling and minimum-one clamping, exceeding the declared 16-million-pixel cap. No image allocation is needed to reproduce. | Shared `pdf_render_bounds.go` uses division-safe checks and restores the area bound after clamping. Extreme aspect ratios, ordinary office/receipt sizes and invalid dimensions are covered. This is a numeric resource bound, not a claim about readable physical output at extreme dimensions. |
| PRINT-06 | Major | `.github/workflows/build-windows.yml` release steps | A Rust-only follow-up can cancel an earlier Agent test run while its own installer skips native Agent tests. Conversely an Agent-only release can skip desktop tests after cancellation. | Every scheduled non-PR installer tests its own native Agent and desktop source. Overall path filtering and scoped, non-packaging PR smoke remain unchanged. Four Python contracts reproduce the missing release gates and verify the corrected behavior. |

PRINT-01 establishes cleanup ownership, not a measured persistent process leak:
PDFium Kill also closes its WASM module. None of these findings independently
establishes why the customer's POS80/Brother/Canon drivers returned zero from GDI.

## Reviewed transport boundaries

| Path | Entry points and evidence inspected | Safety rule retained / remaining acceptance |
| --- | --- | --- |
| Backend selection and configuration | `printer/factory.go`, `printer/capability.go`, `printer/document.go`, `config/config.go` | Transport and byte language are distinct. Private endpoint policy, explicit byte-language evidence and document capability checks are retained. A model name or open port does not authorize protocol substitution. |
| Windows driver queues, USB-installed and network queues | `spooler_windows.go` preflight/session ownership; `pdf_windows.go`, `pdf_bitmap_windows.go`, `pdf_gdi.go`, receipt geometry and tests | Driver geometry/DPI, thread confinement, bounded page rendering, job identity and UNKNOWN after submission remain. Actual installed-driver/Session 0 behavior and physical output need hardware validation. |
| RAW TCP / declared ESC/POS / ZPL / TSPL bytes | `network.go`, factory/capability checks and existing transport tests | Bounded direct dialing and writes; partial writes or ambiguous completion stay UNKNOWN. No speculative PDF bytes or alternate printer language is sent. |
| Direct USB byte endpoints | `usb_windows.go` endpoint binding, write/session ownership and cancellation | Exact USB identity and owned handles; a blocked native writer retains its session until it really returns. Direct USB byte support is not the same as a Windows driver queue's PDF/image support. |
| IPP/IPPS over wired or wireless networking | `ipp.go`, `ipp_formats.go`, `ipp_jpeg_geometry.go`, `pwg_options.go`, response/status and format tests | Probe actual advertised formats; normal certificate validation; no inherited HTTP proxy; no redirect/replay of a submitted document. Native PDF or supported raster conversion only. |
| Discovery versus execution | Shared IPP status reducer and configuration/capability boundaries; prior discovery regression coverage | Reachability or an observation does not prove printable language, physical readiness or permission to publish a queue. Discovery observations must not silently become executable byte transports. |
| Gateway acknowledgement / Agent lifecycle | Selected `agent.go` dispatch admission, claim-token fencing, bounded rejection and terminal re-report queues; existing attempt-evidence tests | A failed acknowledgement does not authorize hardware execution. Terminal/UNKNOWN results cannot be reopened by duplicate delivery. This pass does not change Gateway APIs, tenant policy, local queue format or Odoo producers. |
| Desktop release and repository checks | Full Windows workflow plus existing CI/security entry points | The distributable must come from the tested exact revision. Native tests, build/install smoke and physical printing are separate evidence levels. |

The review covers these boundaries by reading the named source and relevant
callers/tests. Unrelated application screens and all repository files have not
received a new line-by-line certification. Full repository CI is still required;
passing static checks cannot replace live Odoo or hardware acceptance.

## Verification provenance

Before publication, focused tests were run in an isolated standard-library-only
harness with the copied source reducers and new helpers, using Go 1.23.2:
`GO111MODULE=off go test -race -count=20 .` passed. Each defect's regression failed
against the previous logic before correction; release contracts failed twice
against the original workflow and all four passed against the updated workflow.
Changed Go files are gofmt-clean. Exact source copies and uploaded blobs are
compared using Git blob hashes to avoid unintended full-file rewrite drift.

This environment could not run the full locked Go 1.26.10 module or Windows GDI.
The real project/native Windows integration tests therefore must be checked in
GitHub Actions on the implementation commit; local harness results must NOT be
reported as full-project, native-Windows or hardware success. CI failures remain
blocking evidence and are not to be hidden by skipped tests or disabled gates.

## Primary references and consequences

- [RFC 8011, section 5.4.12](https://www.rfc-editor.org/rfc/rfc8011.html#section-5.4.12): explicit report/warning/error severity is meaningful, including multi-output printers. For compatibility, this patch retains the existing conservative treatment of bare known fault keywords; it does not claim complete conformance for all suffix-free legacy devices.
- [RFC 8010](https://www.rfc-editor.org/rfc/rfc8010.html): IPP operation attributes, URI schemes and HTTP transport are separate; retain correlated response evidence and avoid ambiguous replay.
- [Microsoft OpenPrinter](https://learn.microsoft.com/en-us/windows/win32/printdocs/openprinter) and [WritePrinter](https://learn.microsoft.com/en-us/windows/win32/printdocs/writeprinter): blocking native calls and handle synchronization require real ownership until completion; a RAW payload is not automatically rendered by a document driver.
- [Microsoft GDI concurrency](https://learn.microsoft.com/en-us/windows/win32/procthread/multiple-threads-and-gdi-objects): retain existing native object/thread ownership rather than releasing resources while an operation is in flight.
- [Go cancellation patterns](https://go.dev/blog/pipelines): a buffered channel alone does not solve abandonment; result and cleanup ownership must be explicit.
- [Pinned go-pdfium v1.21.3 render implementation](https://github.com/klippa-app/go-pdfium/blob/v1.21.3/internal/implementation_webassembly/render.go) and [worker lifecycle](https://github.com/klippa-app/go-pdfium/blob/v1.21.3/webassembly/webassembly.go): returned image buffers and cleanup are tied to the renderer instance; interruption and cleanup must not race.
- [Epson GS v 0](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_lv_0.html): width is encoded in bytes, height in dots, and command support is model-dependent. The reference marks the command obsolete for some models; blindly replacing it for every ESC/POS clone would not be a verified fix. No such substitution is introduced.

## Rollout and unresolved physical incident

Install the new Windows Agent through the approved upgrade flow. Updating main
or the Gateway does not update a running Windows service binary. Verify the SCM
executable path and build identity. Preserve old UNKNOWN attempts; inspect paper
and the Windows queue before a single new, unique controlled test.

Still unverified: actual installed Agent identity, same-driver service versus
interactive behavior, real POS80/Brother/Canon output, Arabic text/QR readability,
receipt width/feed/cut, physical USB disconnect recovery and real IPP firmware.
A permanently blocked Windows driver can retain its owned worker; early handle
release or automatic retry is not a safe cure. A stronger process-isolated
worker architecture would require a separate design and hardware validation,
not a speculative change concealed as this incident's proven root cause.

## POS80 extreme page length alignment — 21 October 2026

A real POS80 failure reported a 640x828 bitmap placed at Y=12677 with a
printable clip height of 26183. This equals `floor((26183-828)/2)`: the
generic PDF placement policy centered a short document vertically on the
driver's exceptionally long paper form. Agent-owned receipt-image PDFs
already forced Y=0 using an internal crop marker; ordinary PDFs did not.

Only an unmistakably elongated narrow form (40-120mm physical width and
physical length >=4 times that width) is now top-aligned. The detection
uses `PHYSICALWIDTH/HEIGHT` and independent X/Y DPI. Office A4/Letter,
landscape, short narrow forms and wide banners retain centered placement.
PDF source margins remain present: Y=0 means the *printable* origin after
the physical top offset. Page scaling, rendering bounds, DEVMODE negotiation,
protocol selection, and UNKNOWN/no-retry semantics were not changed.

A failing regression reproduced Y=12677 using the reported geometry;
new assertions require (0,0) 640x828 and test anisotropic DPI and normal
office/specialty media. This corrects a deterministic placement defect,
but cannot establish why a specific driver returned zero from
SetDIBitsToDevice or StretchDIBits. Physical paper output and Windows
Service Session 0 behavior must still be checked with the updated Agent.

See Microsoft's GDI geometry definitions:
https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getdevicecaps


## 21 October — Agent/Gateway printer-specific diagnostic selection

Previously Gateway sent a Letter PDF whenever no selected 58/80mm roll was
present in inventory, even for a POS80 spooler with a different current
native form. The Windows Agent also had local selected-paper test code, but
Gateway jobs did not request it; furthermore a 10-metre roll could exceed
the signed DEVMODE paper length when generating the local test PDF.

Gateway now persists `documentType=test_page` for both direct test-print and
physical certification. The Agent reads this nullable field from its
claim-fenced WebSocket/poll envelope. Only PDF test pages on an installed
Windows spooler are regenerated locally using the driver's current native
PHYSICALWIDTH/HEIGHT and separate X/Y DPI, under a bounded preflight. This
runs BEFORE StartDocW and uses the same downstream PDF/GDI printer path, job
identity, atomic session ownership and UNKNOWN/no-auto-retry outcome rules.
Unknown/bad native media fails without submitting an arbitrary paper size.

Narrow, clearly elongated 40–120mm roll forms are given a **100mm-long test
page at their actual physical width**. This prevents 10-metre forms from
causing preflight failure or wasting metres of paper. A4/Letter and short
forms preserve their active sheet geometry. Ordinary Odoo POS image prints,
regular PDFs and declared ESC/POS/RAW/ZPL/TSPL byte jobs are NOT modified.

IPP/IPPS keeps the document-protocol PDF route. Gateway honors explicit
selected A3/A4/A5/Letter/Legal media or a verified 58/80mm roll but does not
guess from marketing device names or advertised-but-unselected paper lists.
Without authoritative IPP media selection, the conservative legacy Letter
source remains and actual IPP printer paper must be verified separately.

This improvement requires a NEW Windows Agent binary: older Agents ignore
`documentType` and still use the Gateway source document directly. Passing
CI verifies source and native software behavior, not real physical output.
