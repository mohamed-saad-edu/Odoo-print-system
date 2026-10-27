"""A remote partial outcome is uncertain physical delivery, never progress.

Execute Odoo's actual _apply_synced_status method via AST, with only ORM,
clock, printer-evidence and audit boundaries replaced. No installed Odoo
runtime or real printer is required for this narrow regression.
"""
import ast
import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

SOURCE = Path(__file__).resolve().parents[1] / "odoo_addons/print_gateway/models/print_job.py"


def load_sync_method():
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "PrintGatewayJob")
    method = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "_apply_synced_status")
    method.decorator_list = []
    namespace = {
        "gateway_output_values": lambda _job, _body, _status: {},
        "db_now_utc": lambda _cr: datetime.datetime(2026, 10, 28, 0, 0, 0),
        "_": lambda message: message,
    }
    exec(compile(ast.fix_missing_locations(ast.Module(body=[method], type_ignores=[])), str(SOURCE), "exec"), namespace)
    return namespace["_apply_synced_status"]


class FakeJob:
    def __init__(self):
        self.id = 42
        self.status = "printing"
        self.gateway_job_id = "gw-42"
        self.printer_id = "printer-42"
        self.notices = []

    def _post_source_audit(self, message):
        self.notices.append(message)


class FakeOutbox:
    _TERMINAL = frozenset(("success", "failed", "partial", "unknown"))
    _GATEWAY_UNKNOWN_MARKERS = ("UNKNOWN_PARTIAL_DELIVERY",)
    env = SimpleNamespace(cr=object())

    def _lock_status_row(self, _job):
        return None

    def _advance_status(self, job, status, values):
        job.status = status
        job.last_error = values.get("last_error")


@pytest.mark.parametrize("remote_error", [None, "some sheets may have printed"])
def test_gateway_partial_delivery_requires_manual_review(remote_error):
    """A remote partial response must never leave an Odoo outbox job as in progress."""
    job = FakeJob()
    body = {"jobId": job.gateway_job_id, "status": "partial"}
    if remote_error is not None:
        body["error"] = remote_error

    assert load_sync_method()(FakeOutbox(), job, body) is True
    assert job.status == "unknown"
    assert job.last_error.startswith("UNKNOWN_PARTIAL_DELIVERY:")
    if remote_error is not None:
        assert remote_error in job.last_error
    assert any("Manual check required" in notice for notice in job.notices)
