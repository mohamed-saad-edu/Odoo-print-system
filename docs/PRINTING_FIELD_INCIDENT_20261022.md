# Office-printer transfer and invoice automation follow-up — 22 October 2026

## Windows evidence and version boundary

The new screenshots show two office queues failing after StartDoc/StartPage:

| Queue/model reported by operator | Source/destination bitmap | Destination origin | Clip bounds | Result |
| --- | --- | --- | --- | --- |
| Brother MFC-J3940DW | 3060 × 4404 px | 0,31 | (0,0)–(3060,4466) | SetDIBitsToDevice=0 |
| Canon G4070 | 3040 × 4375 px | 0,21 | (0,0)–(3040,4417) | SetDIBitsToDevice=0 |

Both rectangles are inside the reported clip bounds. Both advertise
`raster_caps=0x6e99`, `clip_kind=2`, `win32_last_error=158`. The evidence does not
establish a paper-size rejection or a document extending outside those bounds.
The separate POS80 screenshot says submission completed, paper unconfirmed;
it does not prove that a receipt emerged. No live device, source receipt, installed
binary identity, driver version or measured mm/DPI is available to this session.

The prior supplied installer at 42cf19f (20 October) predates 5482922
(21 October), now in main. The latter confines live GDI work to one OS thread,
retains any compatible-bitmap preparation failure alongside a later DIB failure,
and appends session/thread identifiers. Those identifiers are absent from the
new screenshots. This strongly suggests an older running executable; the SCM
process/executable identity is still required to confirm that inference. The
Gateway's 2,000-character error limit does not explain these shorter messages.

For 0x6e99, current code prefers compatible memory-bitmap preparation and uses an
advertised DIB fallback only if preparation fails before printer drawing. The
guard remains one drawing attempt per page; failed physical submission is never
replayed. The existing capability tests cover this exact flag set. No speculative
width/DPI, raster command, transport or customer driver setting is introduced.

[Microsoft SetDIBitsToDevice](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-setdibitstodevice)
documents zero as no transferred scan lines or failure. The
[system error list](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--0-499-)
names 158 ERROR_NOT_LOCKED, but
[GetLastError](https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-getlasterror)
warns that APIs not documented to set last error can leave an earlier value.
This number alone does not prove a memory-lock, media or permission root cause.
See `WINDOWS_GDI_TRANSFER_INVESTIGATION.md` for the active-service version check
and remaining Session 0 driver compatibility boundary.

## Reproduced invoice automation defect

The automation screenshot fails inside
`PrintGatewayBinding.resolve_explicit` before rendering or printer submission:
the explicitly selected binding's report action differs from the policy's report.
The old policy editor filtered bindings only by company/branch and its server
constraint checked the report model but not the selected binding's report ID.
It therefore accepted two different invoice reports on the same model, then
repeated an invalid route until the retry budget expired. The pending banner
incorrectly claimed to be waiting for transaction commit after two attempts.

The offline test reproduced acceptance of this invalid configuration before the
fix. The smallest correction keeps exact report identity authoritative:

- Policy create/write rejects a mismatching explicit rule with names and an
  actionable correction. The form offers rules for the selected report within
  the same existing company/branch scope.
- Editing a rule's report also validates referencing report policies, including
  archived policies. The elevated lookup is limited to bindings being edited;
  it only checks an invariant and never routes or prints across companies.
- Routing revalidates legacy report policies before PDF rendering/outbox creation.
  Implicit routing, RAW policies and the existing exact-binding security guard
  remain intact. No existing customer selection is silently overwritten.
- Pending status is labelled Pending. A zero-attempt intent retains its commit
  message; a pending retry shows a retry/configuration message. Keys, statuses,
  claim fencing, backoff and physical-outcome handling are unchanged.
- Arabic translations and real Odoo create/write/archived-rule/legacy-route
  regressions accompany the offline behavioral checks.

The reverse rule constraint is needed because
[Odoo 19's actual decorator implementation](https://github.com/odoo/odoo/blob/19.0/odoo/orm/decorators.py)
supports simple constraint field names; a dotted `binding_id.report_id`
dependency on the policy would not detect a later binding edit.

An already mismatched customer policy must select a rule for its intended report,
or explicitly clear Target Binding to use the existing automatic resolver. Which
business report/printer is intended cannot safely be guessed from the screenshot.
The addon update prevents recurrence and explains the correction; it does not
rewrite saved customer rules or rearm old jobs automatically.

## Verification and rollout

Local Python suite: 730 passed; focused policy tests include the original red
case. Arabic catalog: 796 terms consistent. Focused view/addon/contract tests
and Go testutil race checks are recorded with final CI/build results on the PR.

The initial current-main Windows build 39754995160 failed in the test-only
`TestMockPrinterReportsReadFailure`: zero captures. Its TCP reset could occur
before the mock accepted the connection on Windows, bypassing the reader under
test. Wait for acceptance before sending/resetting; keep the real reset and both
capture/error assertions. Thirty local race-instrumented repetitions passed.
No production transport code changed for this test correction.

Deploy the updated Odoo `print_gateway` addon and run its normal module upgrade
to apply model/view/translation changes. Windows GDI changes require a current
Agent installer and verification of the actual running SCM executable, not merely
the Manager's version label. Preserve pairing/configuration/durable queue on
upgrade and rollback. Use a fresh synthetic job after inspecting existing UNKNOWN
jobs and the queue; never automatically replay uncertain physical submissions.

**HARDWARE VALIDATION NOT VERIFIED.** Actual office-driver output, physical QR
scanning, receipt clipping, cut/feed and same-driver service/interactive behavior
remain unverified. An unsupported or failed driver cannot safely be reported as
successful paper output. Exact artifact identity and signing trust are recorded
with the final build; an UNTRUSTED-TEST-ONLY artifact is not a production release.
