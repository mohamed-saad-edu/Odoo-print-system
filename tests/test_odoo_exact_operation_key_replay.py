"""Run real Odoo outbox/replay method bodies against exact v2 operation IDs.

The production methods and namespace hash are extracted from current source;
the ORM and Odoo runtime are replaced only at database and external API seams.
No physical printing or live Odoo verification is implied.
"""
import ast
import base64
import contextlib
import copy
import datetime
import importlib.util
import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest


ADDON = Path(__file__).resolve().parents[1] / "odoo_addons" / "print_gateway"


class ValidationError(Exception):
    pass


def _identity_module():
    spec = importlib.util.spec_from_file_location(
        "exact_odoo_operation_namespace", ADDON / "idempotency_namespace.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _method(filename, cls_name, method_name, **injections):
    path = ADDON / "models" / filename
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == cls_name)
    node = next(node for node in cls.body if isinstance(node, ast.FunctionDef) and node.name == method_name)
    node = copy.deepcopy(node)
    node.decorator_list.clear()
    program = ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[]))
    policy_spec = importlib.util.spec_from_file_location(
        "exact_odoo_runtime_policy", ADDON / "runtime_policy.py"
    )
    policy = importlib.util.module_from_spec(policy_spec)
    policy_spec.loader.exec_module(policy)
    ns = {
        "is_exact_gateway_printer_id": policy.is_exact_gateway_printer_id,
        "_": lambda text: text,
        "ValidationError": ValidationError,
        "json": json, "uuid": uuid, "base64": base64,
        "MAX_PRINT_CONTENT_BYTES": 5 * 1024 * 1024,
        "MAX_PRINT_BASE64_CHARS": 4 * ((5 * 1024 * 1024 + 2) // 3),
    }
    ns.update(injections)
    exec(compile(program, str(path), "exec"), ns)
    return ns[method_name]


def test_outbox_persists_exact_local_operation_key_and_v2_wire_identity():
    installation_id = "74e0895b-2508-441e-904b-f19d64fc9be7"
    company = SimpleNamespace(id=42, parent_id=False)
    config = SimpleNamespace(
        id=3, company_id=company,
        _ensure_auto_installation=lambda: installation_id,
        _gateway_base=lambda **_kwargs: "https://gateway.test",
    )
    saved = []

    class Model:
        env = SimpleNamespace(
            company=company,
            cr=SimpleNamespace(dbname="odoo-fixture", savepoint=contextlib.nullcontext),
        )

        def sudo(self):
            return self

        def search(self, _domain, **_kwargs):
            return False

        def create(self, values):
            saved.append(values)
            return SimpleNamespace(
                id=55,
                _validate_persisted_payload=lambda _payload: None,
            )

        def _resolve_payload_kind(self, text):
            value = json.loads(text)
            return value, "raw"

    identity = _identity_module()
    create = _method(
        "print_job.py", "PrintGatewayJob", "create_operation",
        wire_key=identity.wire_key,
        deployment_proof=lambda *_args, **_kwargs: "test-proof",
        db_now_utc=lambda _cr: datetime.datetime(2026, 10, 28),
        IntegrityError=type("IntegrityError", (Exception,), {}),
    )
    original_key = " receipt-operation-7 "
    job = create(
        Model(),
        company=company,
        gateway_config=config,
        printer_id="طابعة-7",
        destination="POS Receipt",
        document_type="receipt",
        idempotency_key=original_key,
        payload={"type": "raw", "protocol": "raw", "encoding": "base64", "data": "YQ=="},
    )
    assert job.id == 55
    assert len(saved) == 1
    assert saved[0]["printer_id"] == "طابعة-7"
    assert saved[0]["idempotency_key"] == original_key
    assert saved[0]["gateway_wire_idempotency_key"] == identity.wire_key(
        2, company.id, original_key, installation_id
    )


def _replay_fixture(key):
    company = SimpleNamespace(id=42)
    source = SimpleNamespace(
        _name="pos.order", id=30, company_id=company, check_access=lambda *_: None
    )
    destination = SimpleNamespace(
        _name="pos.config", id=12, display_name="POS Receipt"
    )
    binding = SimpleNamespace(printer_id="printer-1")
    config = SimpleNamespace(id=3)
    payload = {"type": "image", "encoding": "base64", "data": "JPEG_BASE64"}
    class Job(SimpleNamespace):
        def sudo(self):
            return self

    stored = Job(
        id=71, company_id=company, gateway_config_id=config,
        printer_id="printer-1", destination="POS Receipt",
        destination_key="pos.config,12", document_type="receipt",
        source_model="pos.order", source_record_id=30,
        payload=json.dumps(payload),
    )
    looked_up = []

    class JobModel:
        def search(self, domain, limit=None):
            assert limit == 1
            identity = next(value for name, op, value in domain if name == "idempotency_key")
            looked_up.append(identity)
            return stored if identity == "receipt-operation-7" else False

    class SourceModel:
        def browse(self, pk):
            assert pk == source.id
            return self
        def exists(self):
            return source

    class FakeEnv:
        def __getitem__(self, name):
            if name == "print_gateway.print_job":
                return JobModel()
            if name == "pos.order":
                return SourceModel()
            raise AssertionError(name)

    cursor = SimpleNamespace(close=lambda: None)
    original_env = SimpleNamespace(
        registry=SimpleNamespace(cursor=lambda: cursor),
        uid=4,
        context={},
    )
    obj = SimpleNamespace(
        env=original_env,
        _assert_current_company=lambda value, **_kwargs: value,
        _durable_submission_outcome=lambda job: {"status": "unknown"},
    )
    operation = _method(
        "print_router.py", "PrintGatewayRouter", "_replay_receipt_operation",
        api=SimpleNamespace(Environment=lambda *_args: FakeEnv()),
    )
    route = {
        "binding": binding, "destination": destination, "config": config,
        "document_type": "receipt",
    }
    result = operation(obj, route, source, payload["data"], None, key)
    return result, looked_up


def test_replay_never_mistakes_padded_operation_key_for_a_stored_canonical_key():
    outcome, _lookups = _replay_fixture(" receipt-operation-7 ")
    assert outcome is None


def test_replay_still_reuses_exact_authorized_key_without_new_physical_work():
    outcome, _lookups = _replay_fixture("receipt-operation-7")
    assert outcome == {
        "gateway_enabled": True, "native": False,
        "job_id": 71, "status": "unknown",
    }
