"""Actual Odoo methods: verified selection, approved file output and immutable results."""
import ast
from datetime import datetime, timezone, timedelta
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from odoo_geometry_fixture import validated_printer_geometry, _module as geometry_module

ROOT = Path(__file__).resolve().parents[1]
ADDON = ROOT / "odoo_addons/print_gateway"


class ValidationError(Exception):
    pass


def production_methods(filename, names, namespace=None):
    scope = {"ValidationError": ValidationError, "_": lambda value: value,
             "validated_printer_geometry": validated_printer_geometry,
             "is_gateway_shared_printer": lambda p: p.get("sharedWithGateway") is not False}
    if hasattr(geometry_module, "validated_page_geometry"):
        scope["validated_page_geometry"] = geometry_module.validated_page_geometry
    helper = ADDON / "printer_verification.py"
    if helper.exists():
        spec = importlib.util.spec_from_file_location("odoo_verification_actual", helper)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        scope.update({key: getattr(module, key) for key in dir(module) if not key.startswith("_")})
    # Status reconciliation must use the real immutable-id validation policy,
    # not a permissive mock that silently accepts another Gateway job.
    policy_spec = importlib.util.spec_from_file_location(
        "odoo_runtime_status_identity", ADDON / "runtime_policy.py"
    )
    policy = importlib.util.module_from_spec(policy_spec)
    policy_spec.loader.exec_module(policy)
    scope["is_exact_gateway_job_id"] = policy.is_exact_gateway_job_id
    scope["is_exact_gateway_printer_id"] = policy.is_exact_gateway_printer_id
    scope["is_exact_gateway_agent_id"] = policy.is_exact_gateway_agent_id
    scope["unambiguous_inventory_rows"] = policy.unambiguous_inventory_rows
    scope.update(namespace or {})
    nodes = []
    for node in ast.walk(ast.parse((ADDON / filename).read_text())):
        if isinstance(node, ast.FunctionDef) and node.name in names:
            node.decorator_list = []
            nodes.append(node)
    assert len(nodes) == len(names)
    exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), str(ADDON / filename), "exec"), scope)
    return type("Production", (), {name: scope[name] for name in names})


def verified_printer(connection="spooler", protocol="spooler", now=None):
    now = now or datetime.now(timezone.utc)
    stamp = now.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    method = {"spooler": "windows_queue", "pdf_output": "pdf_output", "usb": "usb_interface", "network": "snmp_printer", "ipp": "ipp_attributes", "ipps": "ipp_attributes"}[connection]
    strength = {"windows_queue": "queue", "ipp_attributes": "service", "usb_interface": "device", "snmp_printer": "device", "pdf_output": "service"}[method]
    medium = "file" if connection == "pdf_output" else "physical"
    return {"id": "selected-printer", "connectionType": connection, "protocol": protocol,
            "printerType": "file" if medium == "file" else "physical", "deviceClass": "laser",
            "lifecycle": "active", "agent": {"id": "agt_fixture1"}, "sharedWithGateway": True,
            "verificationState": "verified", "verificationVerifiedAt": stamp,
            "verificationReceivedAt": stamp, "outputMedium": medium,
            "capabilities": {"supported_protocols": ["pdf", "image"],
                "operational_verification": {"version": 1, "verified_at": stamp,
                    "printer_id": "selected-printer", "binding_digest": "a" * 64,
                    "logical_queue_key": "a" * 64, "method": method,
                    "identity_strength": strength, "output_medium": medium},
                "geometry": {"version": 1, "source": "validated_profile", "validation": "configured",
                    "observed_at": stamp, "printer_id": "selected-printer", "config_fingerprint": "b" * 64,
                    "paper_width_mm": 210, "paper_height_mm": 297, "dpi_x": 300, "dpi_y": 300,
                    "printable_width_dots": 2244, "printable_height_dots": 3271,
                    "offset_x_dots": 118, "offset_y_dots": 118}}}


def test_all_synthetic_evidence_strengths_match_production_runtime_validator():
    # This standalone verifier exercises the same Odoo function that guards
    # real printer discovery; fake identities must not rely on weaker proof.
    verifier = production_methods(
        "models/binding.py", ["_validate_runtime_target"]
    )._validate_runtime_target.__globals__["is_verified_runtime_printer"]
    for connection, protocol, method, strength in (
        ("spooler", "spooler", "windows_queue", "queue"),
        ("ipp", "ipp", "ipp_attributes", "service"),
        ("ipps", "ipps", "ipp_attributes", "service"),
        ("usb", "escpos", "usb_interface", "device"),
        ("network", "escpos", "snmp_printer", "device"),
        ("pdf_output", "pdf", "pdf_output", "service"),
    ):
        printer = verified_printer(connection, protocol)
        proof = printer["capabilities"]["operational_verification"]
        assert (proof["method"], proof["identity_strength"]) == (method, strength)
        assert verifier(printer)
        proof["identity_strength"] = "queue" if strength != "queue" else "device"
        assert not verifier(printer)


def binding(printer):
    responses = iter([{"agents": [{"id": "agt_fixture1", "lifecycle": "active"}]}, {"printers": [printer]}])
    requests = SimpleNamespace(get=lambda *_a, **_kw: SimpleNamespace(status_code=200, json=lambda: next(responses)), RequestException=OSError)
    methods = production_methods("models/binding.py", ["_canonical_runtime_printer_protocol", "_runtime_printer_accepts_image",
        "_runtime_supported_protocols", "_validate_binding_protocol_against_runtime", "_validate_runtime_target"], {"requests": requests})
    result = methods()
    result.ensure_one = lambda: None
    result.runtime_agent_id, result.printer_id, result.branch_id = "agt_fixture1", printer["id"], False
    result.destination_type, result.printer_protocol, result.report_id = "pos", printer["protocol"], False
    result.env = {"print_gateway.runtime_agent_assignment": SimpleNamespace(is_agent_assigned=lambda *_: True)}
    result._get_gateway_config = lambda: SimpleNamespace(company_id=1, _gateway_base=lambda **_: "https://gateway.invalid", _gateway_headers=lambda: {})
    return result


def test_approved_pdf_output_is_a_class_agnostic_pos_document_transport():
    printer = verified_printer("pdf_output", "pdf")
    actual = binding(printer)
    assert actual._canonical_runtime_printer_protocol(printer) == "pdf"
    assert actual._runtime_printer_accepts_image(printer)
    assert actual._validate_binding_protocol_against_runtime(printer)
    assert actual._validate_runtime_target() is printer


@pytest.mark.parametrize("kind", ["missing", "pending", "expired", "other-id", "wrong-medium", "future-receipt", "other-proof"])
def test_registered_online_printer_requires_fresh_identity_bound_operational_evidence(kind):
    printer = verified_printer()
    printer["status"] = "online"
    if kind == "missing":
        printer["capabilities"].pop("operational_verification")
    elif kind == "pending":
        printer["verificationState"] = "pending"
    elif kind == "expired":
        printer["verificationReceivedAt"] = (datetime.now(timezone.utc) - timedelta(seconds=301)).isoformat().replace("+00:00", "Z")
    elif kind == "other-id":
        printer["capabilities"]["operational_verification"]["printer_id"] = "other-printer"
    elif kind == "wrong-medium":
        printer["outputMedium"] = "file"
    elif kind == "future-receipt":
        printer["verificationReceivedAt"] = (datetime.now(timezone.utc) + timedelta(seconds=61)).isoformat().replace("+00:00", "Z")
    else:
        printer["verificationVerifiedAt"] = (datetime.now(timezone.utc) - timedelta(seconds=2)).isoformat().replace("+00:00", "Z")
    with pytest.raises(ValidationError, match="verif|eligible"):
        binding(printer)._validate_runtime_target()


@pytest.mark.parametrize("device_class", ["laser", "inkjet", "unknown"])
def test_verified_driver_selection_has_no_thermal_class_requirement(device_class):
    printer = verified_printer()
    printer["deviceClass"] = device_class
    assert binding(printer)._validate_runtime_target() is printer


@pytest.mark.parametrize("missing", ["paper_width_mm", "paper_height_mm", "printable_height_dots", "offset_x_dots", "offset_y_dots", "dpi_x", "dpi_y"])
def test_file_receipt_requires_complete_page_geometry(missing):
    printer = verified_printer("pdf_output", "pdf")
    del printer["capabilities"]["geometry"][missing]
    assert binding(printer)._runtime_printer_accepts_image(printer) is False


def test_file_geometry_cannot_authorize_an_arbitrary_virtual_spooler():
    printer = verified_printer("pdf_output", "pdf")
    printer["connectionType"] = "spooler"
    printer["protocol"] = "spooler"
    with pytest.raises(ValidationError, match="verif|eligible"):
        binding(printer)._validate_runtime_target()


SHARED = json.loads((ROOT / "contracts/printer-operational-verification-fixtures.json").read_text())


@pytest.mark.parametrize("case", SHARED["proofCases"], ids=lambda case: case["name"])
def test_operational_reader_agrees_with_shared_gateway_agent_vectors(case):
    scope = production_methods("models/binding.py", ["_validate_runtime_target"])._validate_runtime_target.__globals__
    assert bool(scope["validated_operational_verification"](case["proof"], case["printer"], datetime.fromisoformat(SHARED["now"].replace("Z", "+00:00")))) is case["valid"]


def test_explicit_pdf_report_binding_can_use_approved_file_backend():
    actual = production_methods("models/binding.py", ["resolve_explicit"])()
    actual.ensure_one = lambda: None
    company = SimpleNamespace(id=1)
    class OneRecord(SimpleNamespace):
        def __len__(self):
            return 1
    selected = OneRecord(id=1, company_id=company, branch_id=False, enabled=True,
        runtime_agent_id="agt_fixture1", printer_id="file-printer", printer_protocol="pdf", document_type="invoice",
        destination_ref="report", report_id=False, status="active")
    selected.ensure_one = lambda: None
    selected.exists = lambda: selected
    selected.sudo = lambda: selected
    actual.env = SimpleNamespace(context={})
    assert actual.resolve_explicit(selected, company, "invoice", "report", payload_type="pdf") is selected


def test_runtime_picker_preserves_verified_medium_and_canonical_evidence():
    from test_agent_print_diagnostic_media import runtime_controller
    printer = verified_printer("pdf_output", "pdf")
    result = runtime_controller(printer)["printers"][0]
    for key in ("verificationState", "verificationVerifiedAt", "verificationReceivedAt", "outputMedium", "printerType"):
        assert result.get(key) == printer[key]
    assert result["capabilities"].get("operational_verification") == printer["capabilities"]["operational_verification"]


def test_runtime_picker_discards_expired_operational_evidence():
    from test_agent_print_diagnostic_media import runtime_controller
    printer = verified_printer(now=datetime.now(timezone.utc) - timedelta(seconds=301))
    assert runtime_controller(printer)["printers"] == []


FILE_EVIDENCE = {"output_medium": "file", "artifact_id": "file_fixture_42", "sha256": "c" * 64, "page_count": 2, "bytes": 4096}


def synced_file(body, existing=None):
    helper = ADDON / "print_output.py"
    scope = {"db_now_utc": lambda _cr: datetime.now(timezone.utc)}
    if helper.exists():
        spec = importlib.util.spec_from_file_location("odoo_output_actual", helper)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        scope.update({key: getattr(module, key) for key in dir(module) if not key.startswith("_")})
    actual = production_methods("models/print_job.py", ["_apply_synced_status"], scope)()
    actual._TERMINAL = {"success", "failed", "unknown", "partial"}
    actual._GATEWAY_UNKNOWN_MARKERS = ("AGENT_EXECUTION_TIMEOUT", "UNKNOWN_SUBMISSION_OUTCOME")
    actual.env = SimpleNamespace(cr=None)
    actual._lock_status_row = lambda _job: None
    actual._advance_status = lambda job, status, values: vars(job).update(values, status=status)
    job = SimpleNamespace(id=1, gateway_job_id="remote-original", status="printing", printer_id="file-a", physical_outcome="unknown",
        output_medium="file", output_outcome="unknown", output_evidence=existing or False, _post_source_audit=lambda _message: None)
    job.sudo = lambda: job
    job.write = lambda values: vars(job).update(values)
    assert actual._apply_synced_status(job, {"jobId": "remote-original", **body})
    return job


def test_sync_persists_validated_file_creation_evidence_without_physical_completion():
    job = synced_file({"status": "success", "outputMedium": "file", "outputOutcome": "file_created", "outputEvidence": FILE_EVIDENCE})
    assert job.output_evidence == FILE_EVIDENCE
    assert job.output_outcome == "file_created"
    assert job.physical_outcome == "unknown"


def test_file_success_without_canonical_artifact_evidence_is_unverified():
    job = synced_file({"status": "success", "outputMedium": "file", "outputOutcome": "file_created", "outputEvidence": {**FILE_EVIDENCE, "path": "/private/output.pdf"}})
    assert job.output_outcome == "unknown"
    assert not job.output_evidence


def test_later_response_cannot_replace_persisted_file_artifact_identity():
    with pytest.raises(ValueError, match="evidence|artifact"):
        synced_file({"status": "success", "outputMedium": "file", "outputOutcome": "file_created", "outputEvidence": {**FILE_EVIDENCE, "sha256": "d" * 64}}, existing=FILE_EVIDENCE)


def test_file_receipt_feedback_reports_file_creation_and_retains_original_job_identity():
    actual = production_methods("models/print_router.py", ["_durable_submission_outcome", "_submission_message"])()
    job = SimpleNamespace(id=42, status="success", gateway_job_id="remote-original", physical_outcome="unknown",
        output_medium="file", output_outcome="file_created", output_evidence=FILE_EVIDENCE)
    result = actual._durable_submission_outcome(job)
    assert result.get("outputMedium") == "file"
    assert result.get("outputEvidence") == FILE_EVIDENCE
    assert result.get("outputOutcome") == "file_created"
    assert "file" in result["message"].lower() and "paper" not in result["message"].lower()
    assert result["gateway_job_id"] == "remote-original" and result["can_retry"] is False


@pytest.mark.parametrize("case", SHARED["fileOutputCases"], ids=lambda case: case["name"])
def test_file_result_reader_matches_shared_gateway_agent_vectors(case):
    path = ADDON / "print_output.py"
    spec = importlib.util.spec_from_file_location("actual_file_output", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert bool(module.validated_file_output(case["evidence"])) is case["valid"]


def test_missing_later_file_evidence_cannot_erase_an_original_verified_artifact():
    job = synced_file({"status": "success", "outputMedium": "file", "outputOutcome": "unknown", "outputEvidence": None}, existing=FILE_EVIDENCE)
    assert job.output_evidence == FILE_EVIDENCE


def test_gateway_sync_requires_unambiguous_exact_job_identity_before_reporting_success():
    """A 200 response with missing or contradictory identities cannot advance paper state."""
    def forbidden(*_args, **_kwargs):
        raise AssertionError("unbound Gateway status must not read output evidence or mutate a job")

    method = production_methods(
        "models/print_job.py", ["_apply_synced_status"],
        {"gateway_output_values": forbidden, "db_now_utc": forbidden},
    )()
    method.env = SimpleNamespace(cr=None)
    method._lock_status_row = lambda _job: None
    method._advance_status = forbidden
    method._apply_gateway_late_success = forbidden
    job = SimpleNamespace(gateway_job_id="remote-original", status="printing")
    for remote_response in [
        {"status": "success"},
        {"jobId": None, "status": "success"},
        {"jobId": "", "status": "success"},
        {"id": "remote-original", "jobId": "other-job", "status": "success"},
        {"jobId": "remote-original", "id": "another-job", "status": "success"},
        {"jobId": "remote-original", "id": "", "status": "success"},
        {"jobId": "remote-original", "status": "completed", "id": 7},
    ]:
        assert method._apply_synced_status(job, remote_response) is False, remote_response
        assert job.status == "printing"
