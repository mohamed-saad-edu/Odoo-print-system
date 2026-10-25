"""Live fallback target checks execute real production decision methods offline."""
import datetime
import logging
from types import MethodType, SimpleNamespace

import pytest

from test_odoo_discovery_response_safety import (
    AGENTS, PRINTER, ValidationError, discovery, method,
)


@pytest.mark.parametrize("case, allowed", [
    ("authorized", True),
    ("assignment_revoked", False),
    ("owner_changed", False),
    ("printer_retired", False),
    ("printer_private", False),
    ("stale_verification", False),
    ("protocol_changed", False),
    ("discovery_unavailable", False),
])
def test_fallback_revalidates_current_assignment_owner_and_verification(monkeypatch, case, allowed):
    printer = dict(PRINTER)
    if case == "owner_changed":
        printer["agent"] = {"id": "another-branch-agent"}
    if case == "printer_retired":
        printer["lifecycle"] = "retired"
    if case == "printer_private":
        printer["sharedWithGateway"] = False
    if case == "protocol_changed":
        printer["protocol"] = "zpl"
    _, binding, transport = discovery(monkeypatch, agents=AGENTS, printers=[printer])
    if case == "stale_verification":
        responses = list(transport.side_effect)
        responses[1].json()["printers"][0]["verificationReceivedAt"] = "2020-01-01T00:00:00Z"
        transport.side_effect = responses
    if case == "discovery_unavailable":
        transport.side_effect = ValidationError("Gateway runtime agent discovery is unavailable.")
    binding.env["print_gateway.runtime_agent_assignment"].is_agent_assigned = lambda *args: case != "assignment_revoked"
    binding._validate_runtime_target = binding.validate
    namespace = binding.validate.__func__.__globals__
    for name in ("_runtime_supported_protocols", "_validate_binding_protocol_against_runtime"):
        setattr(binding, name, MethodType(method("models/binding.py", name, namespace), binding))

    company = SimpleNamespace(id=1, parent_id=False)
    branch = SimpleNamespace(id=2, parent_id=company)
    report = SimpleNamespace(_name="ir.actions.report", id=3, display_name="Invoice")
    binding.company_id = company
    binding.branch_id = branch
    binding.enabled = True
    binding.destination_ref = report
    binding.report_id = report
    binding.document_type = "invoice"
    binding.printer_protocol = "escpos"
    binding.fallback_binding_id = False

    writes = []
    job = SimpleNamespace(
        id=11, attempts=0, printer_id="original-printer", company_id=branch,
        destination_key="ir.actions.report,3", document_type="invoice", report_id=report,
        payload_type="raw_cmd", protocol="escpos", idempotency_key="existing-operation-identity",
        write=lambda values: writes.append(values), _post_source_audit=lambda message: None,
    )
    service = SimpleNamespace(env=SimpleNamespace(cr=object()), _primary_shared_for_fallback=lambda job: True)
    handler = method("models/print_job.py", "_handle_pre_dispatch_failure", {
        "ValidationError": ValidationError, "_": lambda message: message,
        "datetime": datetime, "db_now_utc": lambda cr: datetime.datetime(2026, 10, 25),
        "_logger": logging.getLogger(__name__),
    })
    next_binding, count, resume = handler(service, job, ConnectionRefusedError("No bytes transmitted"),
                                         binding, {"original-printer"}, 0, False)
    assert (resume == "continue") is allowed
    assert count == (1 if allowed else 0)
    assert job.idempotency_key == "existing-operation-identity"
    if allowed:
        assert writes[0]["printer_id"] == "printer"
    else:
        assert all("printer_id" not in values for values in writes)
        assert writes[-1]["status"] == "queued"
        assert writes[-1]["attempts"] == 1
