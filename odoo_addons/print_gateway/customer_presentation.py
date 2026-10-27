# -*- coding: utf-8 -*-
"""Locale-aware customer presentation; never changes admission or retry policy.

Stored worker diagnostics remain evidence. They are classified here and never
interpolated into customer text. Pass the current reader's ``env._`` so cron's
language, a previous administrator's language and raw remote errors cannot leak
into the interface. There is deliberately no import-time translation cache.
"""


def job_customer_state(status, physical_outcome, output_medium=None, output_outcome=None):
    if output_medium == "file":
        if output_outcome == "file_created":
            return "file_created"
        if output_outcome == "not_created" and status in ("failed", "unknown", "partial"):
            return "failed_before_output"
        if status in ("success", "failed", "unknown", "partial"):
            return "needs_review"
    if status == "queued":
        return "waiting"
    if status in ("submitted", "claimed", "printing"):
        return "processing"
    if status == "success":
        return "sent_to_printer"
    if status == "failed" and physical_outcome == "not_printed":
        return "failed_before_output"
    return "needs_review"


def customer_error_category(value=None, *, code=None, status=None):
    # Bound processing of historical diagnostics. Only the chosen category,
    # never these strings, is returned or translated.
    text = (str(code or "") + " " + str(value or "")[:4000]).upper()
    if any(token in text for token in ("UNKNOWN_", "UNCERTAIN", "PARTIAL_DELIVERY", "AMBIGUOUS")):
        return "uncertain"
    if "GATEWAY_REJECTED_STALE_POS_OPERATION" in text:
        return "stale_pos"
    if "PRINT_QUOTA_EXCEEDED" in text or "MAX_PRINTS_PER_PERIOD" in text:
        return "quota"
    if any(token in text for token in ("SUBSCRIPTION", "TENANT_SUSPENDED", "TENANT_DELETED", "TENANT_ENTITLEMENT_UNAVAILABLE")):
        return "subscription"
    if status == 401 or any(token in text for token in ("API_KEY", "CREDENTIAL", "UNAUTHORIZED", "INVALIDHEADER")):
        return "credential"
    if any(token in text for token in ("VERIFICATION", "UNVERIFIED", "DEVICE_NOT_APPROVED")):
        return "verification"
    if any(token in text for token in ("PRINTER_OFFLINE", "AGENT_OFFLINE", "PRINTER_NOT_FOUND", "PRINTER_UNAVAILABLE", "PRINTER_NOT_SHARED")):
        return "printer"
    if status == 429 or any(token in text for token in ("QUEUE_FULL", "RATE_LIMIT", "MAX_CONCURRENT_JOBS", "MAX_JOBS_PER_MINUTE")):
        return "busy"
    if any(token in text for token in ("REDIRECT", "GATEWAY_ORIGIN", "GATEWAY URL")):
        return "address"
    if status == 503 or any(token in text for token in ("CONNECTION_ERROR", "CONNECTIONERROR", "TIMED OUT", "TIMEOUT", "COULD NOT REACH")):
        return "connection"
    if status == 403 or any(token in text for token in ("ACCESSERROR", "PERMISSION", "FORBIDDEN")):
        return "permission"
    return "operation"


def customer_error_message(_, value=None, *, code=None, status=None):
    if not value and not code and status is None:
        return ""
    category = customer_error_category(value, code=code, status=status)
    if category == "uncertain":
        return _("The print result needs review. Check the printer before starting another print to avoid duplicate output.")
    if category == "stale_pos":
        return _("This old POS ticket was not sent. Review the sale and explicitly reprint only if needed.")
    if category == "quota":
        return _("This month's print-job allowance has been used. Wait for the monthly reset or contact the workspace owner.")
    if category == "subscription":
        return _("Printing is not active for this workspace. Ask the workspace owner to review its subscription in Yaseir.")
    if category == "credential":
        return _("The connection key is not accepted. Create a replacement in Connect Odoo, save it here, and check the connection.")
    if category == "verification":
        return _("This printer has not passed verification. Open the Windows printing app and verify the real printer before selecting it.")
    if category == "printer":
        return _("The selected printer is unavailable. Check that its computer is connected and the printer is ready and shared.")
    if category == "busy":
        return _("The printing service is busy. Wait a moment and check Print Activity before trying again.")
    if category == "address":
        return _("Check the connection address. Use the secure address shown in Connect Odoo, without an API path or redirect.")
    if category == "connection":
        return _("The printing service could not be reached. Check the internet connection and connection address, then check Print Activity before retrying.")
    if category == "permission":
        return _("You do not have permission for this printing action. Ask your company administrator to review access.")
    return _("This printing action could not be completed. Review the connection, selected printer and Print Activity. Contact your administrator if the problem continues.")
