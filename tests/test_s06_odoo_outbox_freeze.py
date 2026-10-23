"""Executable Odoo method-level identity tests without pretending to run native ORM."""
import ast
import hashlib
from pathlib import Path
from types import SimpleNamespace

from test_s06_versioned_keys import impl

SRC = Path(__file__).resolve().parents[1] / "odoo_addons/print_gateway/models/print_job.py"


def method(name):
    module = ast.parse(SRC.read_text())
    klass = next(n for n in module.body if isinstance(n, ast.ClassDef) and n.name == "PrintGatewayJob")
    fun = next(n for n in klass.body if isinstance(n, (ast.FunctionDef,ast.AsyncFunctionDef)) and n.name == name)
    ns = {"hashlib":hashlib,"wire_key":impl().wire_key}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[fun],type_ignores=[])), str(SRC), "exec"), ns)
    return ns[name]


def test_legacy_saved_jobs_retain_the_original_v1_key_after_cutover():
    call = method("_gateway_idempotency_key")
    old = SimpleNamespace(company_id=SimpleNamespace(id=7), idempotency_key="event-42",
      gateway_wire_idempotency_key=False, gateway_installation_id=False,
      gateway_idempotency_version=1, ensure_one=lambda:None)
    assert call(old) == hashlib.sha256(b"odoo:7:event-42").hexdigest()


def test_new_jobs_use_persisted_wire_identity_even_if_installation_changes():
    call = method("_gateway_idempotency_key")
    pinned = impl().wire_key(2,7,"event-42","00000000-0000-4000-8000-000000000001")
    job = SimpleNamespace(company_id=SimpleNamespace(id=7), idempotency_key="event-42",
      gateway_wire_idempotency_key=pinned, gateway_installation_id="00000000-0000-4000-8000-000000000001",
      gateway_idempotency_version=2, ensure_one=lambda:None)
    assert call(job) == pinned
