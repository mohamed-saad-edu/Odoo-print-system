"""Gateway runtime identity permissions, independent of local device health."""

import re

# Keep in sync with src/lib/agent-auth.ts (AGENT_ID_PATTERN). An Agent ID
# is not an arbitrary printer queue ID: mis-typed values must not be enrolled.
_AGENT_ID_PATTERN = re.compile(r"agt_[A-Za-z0-9_-]{8}\Z")


def is_exact_gateway_agent_id(value):
    return isinstance(value, str) and _AGENT_ID_PATTERN.fullmatch(value) is not None


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


def unambiguous_inventory_rows(rows):
    """Deduplicate identical opaque identities without accepting conflicts.

    An untrusted upstream inventory is not iterable authority. Return an
    empty set for malformed envelopes rather than allowing a TypeError to
    escape after a successful HTTP request.
    """
    if not isinstance(rows, list):
        return []
    seen = {}
    ambiguous = set()
    for record in rows:
        identity = record.get("id") if isinstance(record, dict) else None
        if not is_exact_gateway_printer_id(identity):
            continue
        if identity in seen:
            if seen[identity] != record:
                ambiguous.add(identity)
        else:
            seen[identity] = record
    return [record for identity, record in seen.items() if identity not in ambiguous]


def inventory_has_shared_printer(body, printer_id):
    """Fresh authenticated inventory must prove the exact primary identity."""
    if not is_exact_gateway_printer_id(printer_id):
        return False
    printers = body.get("printers") if isinstance(body, dict) else None
    if not isinstance(printers, list):
        return False
    for printer in unambiguous_inventory_rows(printers):
        if printer.get("id") != printer_id:
            continue
        agent = printer.get("agent")
        if (printer.get("lifecycle") == "active" and is_gateway_shared_printer(printer)
                and isinstance(agent, dict) and is_exact_gateway_agent_id(agent.get("id"))):
            return True
    return False
