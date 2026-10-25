"""Explicit synthetic Agent evidence, never a physical printer acceptance result."""
from datetime import datetime, timezone


def verified_printer(printer):
    result = dict(printer)
    connection, protocol = result.get("connectionType"), result.get("protocol")
    medium = "file" if connection == "pdf_output" else "physical"
    method = "pdf_output" if medium == "file" else "windows_queue" if connection == "spooler" else "ipp_attributes" if connection in ("ipp", "ipps") or protocol in ("ipp", "ipps") else "usb_interface" if connection == "usb" else "snmp_printer"
    stamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    result.update(verificationState="verified", verificationVerifiedAt=stamp, verificationReceivedAt=stamp,
                  outputMedium=medium, printerType="file" if medium == "file" else "physical")
    result["capabilities"] = {**result.get("capabilities", {}), "operational_verification": {
        "version": 1, "verified_at": stamp, "printer_id": result["id"], "binding_digest": "a" * 64,
        "logical_queue_key": "a" * 64, "method": method, "identity_strength": "service" if medium == "file" else "queue",
        "output_medium": medium}}
    return result
