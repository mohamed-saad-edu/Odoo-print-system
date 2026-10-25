"""Synthetic current proof for tests; invokes the real pure Odoo parser."""
from datetime import datetime, timezone
import importlib.util
from pathlib import Path

_path = Path(__file__).resolve().parents[1] / "odoo_addons/print_gateway/printer_verification.py"
_spec = importlib.util.spec_from_file_location("odoo_verification_fixture_module", _path)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
is_verified_runtime_printer = _module.is_verified_runtime_printer


def with_verification(printer):
    result = dict(printer)
    connection = result.setdefault("connectionType", "spooler")
    protocol = result.setdefault("protocol", "spooler")
    file_output = connection == "pdf_output"
    method = "pdf_output" if file_output else "windows_queue" if connection == "spooler" else "ipp_attributes" if connection in ("ipp", "ipps") or protocol in ("ipp", "ipps") else "usb_interface" if connection == "usb" else "snmp_printer"
    stamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    result.update(verificationState="verified", verificationVerifiedAt=stamp, verificationReceivedAt=stamp,
                  outputMedium="file" if file_output else "physical", printerType="file" if file_output else "physical")
    result["capabilities"] = {**result.get("capabilities", {}), "operational_verification": {
        "version": 1, "verified_at": stamp, "printer_id": result["id"], "binding_digest": "a" * 64,
        "logical_queue_key": "a" * 64, "method": method, "identity_strength": "service" if file_output else "queue",
        "output_medium": result["outputMedium"]}}
    return result
