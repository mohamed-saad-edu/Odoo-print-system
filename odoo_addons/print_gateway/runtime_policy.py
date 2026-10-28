"""Gateway printer permissions, independent of local device health."""


def is_exact_gateway_printer_id(value):
    """Keep Odoo printer targets byte-identical to Gateway/Agent execution IDs.

    The shared Gateway wire contract accepts up to 120 UTF-8 bytes; no
    leading/trailing Unicode whitespace, C0/C1 controls or unpaired UTF-16
    surrogates may be silently normalized into another target.
    """
    if (not isinstance(value, str) or not value or value != value.strip()
            or value.startswith("\ufeff") or value.endswith("\ufeff")):
        return False
    if any(ord(ch) < 32 or 127 <= ord(ch) <= 159 for ch in value):
        return False
    try:
        return len(value.encode("utf-8", "strict")) <= 120
    except UnicodeEncodeError:
        return False


def is_exact_gateway_job_id(value):
    """Gateway /api/print/jobs GET uses the same exact 120-byte ID contract.

    An ambiguous physical submission may only bind to the exact remote
    job identity; trimming a response can reconcile the wrong operation.
    """
    return is_exact_gateway_printer_id(value)


def is_gateway_shared_printer(printer):
    """Accept legacy inventory; explicit/malformed sharing metadata fails closed."""
    return isinstance(printer, dict) and printer.get("sharedWithGateway", True) is True


def inventory_has_shared_printer(body, printer_id):
    """Fresh authenticated inventory must prove the exact primary identity."""
    printers = body.get("printers") if isinstance(body, dict) else None
    if not isinstance(printers, list):
        return False
    for printer in printers:
        if not isinstance(printer, dict) or printer.get("id") != printer_id:
            continue
        agent = printer.get("agent")
        if (printer.get("lifecycle") == "active" and is_gateway_shared_printer(printer)
                and isinstance(agent, dict) and isinstance(agent.get("id"), str) and agent["id"].strip()):
            return True
    return False
