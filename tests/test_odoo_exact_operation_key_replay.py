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
import re
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


@pytest.mark.parametrize("operation_key", [" receipt-operation-7 ", None, False, ""])
def test_outbox_persists_exact_local_operation_key_and_v2_wire_identity(operation_key):
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
    original_key = operation_key
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
    if isinstance(original_key, str) and original_key:
        assert saved[0]["idempotency_key"] == original_key
    else:
        assert re.fullmatch(r"[0-9a-f]{32}", saved[0]["idempotency_key"])
    assert saved[0]["gateway_wire_idempotency_key"] == identity.wire_key(
        2, company.id, saved[0]["idempotency_key"], installation_id
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



def test_durable_cursor_recheck_rejects_repointed_padded_printer_alias():
    # A change between the first routing transaction and the durable
    # outbox transaction must never trim another printer ID into a match.
    calls = []
    binding = SimpleNamespace(
        id=9, enabled=True, printer_id=" printer-1 ", runtime_agent_id=False,
    )

    class BindingModel:
        def sudo(self):
            return self
        def browse(self, binding_id):
            assert binding_id == 9
            return self
        def exists(self):
            return binding

    class OutboxModel:
        def create_operation(self, **_values):
            calls.append("admitted")
            return SimpleNamespace(id=101)

    class FakeEnv:
        def __getitem__(self, name):
            if name == "print_gateway.binding":
                return BindingModel()
            if name == "print_gateway.print_job":
                return OutboxModel()
            raise AssertionError(name)

    cursor = SimpleNamespace(close=lambda: None, commit=lambda: calls.append("commit"))
    router = SimpleNamespace(env=SimpleNamespace(
        registry=SimpleNamespace(cursor=lambda: cursor), uid=5, context={}
    ))
    persist = _method(
        "print_router.py", "PrintGatewayRouter", "_persist_durable_job",
        api=SimpleNamespace(Environment=lambda *_args: FakeEnv()),
    )
    with pytest.raises(ValidationError, match="repointed"):
        persist(router, {
            "company": False, "gateway_config": False,
            "binding": SimpleNamespace(id=9), "printer_id": "printer-1",
        })
    assert calls == []



@pytest.mark.parametrize("remote_id", [
    " remote-job", "remote-job ", "\ufeffremote-job",
    "remote-job\ufeff", "\x00remote-job", "é" * 61, "😀" * 31,
])
def test_ambiguous_submission_lookup_rejects_unexecutable_remote_job_id(remote_id):
    response = SimpleNamespace(
        status_code=200,
        raise_for_status=lambda: None,
        json=lambda: {"jobId": remote_id, "status": "success"},
    )
    invoked = []
    config = SimpleNamespace(
        _gateway_base=lambda **_kwargs: "https://gateway.test",
        _gateway_headers=lambda: {"Authorization": "Bearer redacted"},
        sudo=lambda: None,
    )
    config.sudo = lambda: config
    class Job(SimpleNamespace):
        def ensure_one(self):
            return None
        def sudo(self):
            return self
        def write(self, values):
            invoked.append(values)
            self.gateway_job_id = values["gateway_job_id"]

    job = Job(
        id=51, status="unknown", gateway_job_id=False,
        last_error="UNKNOWN_SUBMISSION_OUTCOME: unresolved remote acceptance",
        gateway_config_id=config, gateway_idempotency_version=1,
        _gateway_idempotency_key=lambda: "original-operation",
    )
    policy = _runtime_identity()
    lookup = _method(
        "print_job.py", "PrintGatewayJob", "_lookup_gateway_job_for_ambiguous_submission",
        requests=SimpleNamespace(get=lambda *_args, **_kwargs: response),
        is_exact_gateway_job_id=policy,
    )
    controller = SimpleNamespace(
        _lock_status_row=lambda _job: None,
        _mark_gateway_job_missing=lambda *_args: None,
    )
    with pytest.raises(ValueError, match="job id"):
        lookup(controller, job)
    assert invoked == []


def _runtime_identity():
    spec = importlib.util.spec_from_file_location(
        "reconciliation_identity_policy", ADDON / "runtime_policy.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.is_exact_gateway_job_id


def test_ambiguous_submission_lookup_keeps_authorized_exact_remote_id():
    identity = "طباعة-job-17"
    response = SimpleNamespace(
        status_code=200,
        raise_for_status=lambda: None,
        json=lambda: {"jobId": identity, "status": "claimed"},
    )
    saved = []
    config = SimpleNamespace(
        _gateway_base=lambda **_kwargs: "https://gateway.test",
        _gateway_headers=lambda: {"Authorization": "Bearer redacted"},
    )
    config.sudo = lambda: config
    class Job(SimpleNamespace):
        def ensure_one(self): return None
        def sudo(self): return self
        def write(self, values):
            saved.append(values)
            self.gateway_job_id = values["gateway_job_id"]

    job = Job(
        id=52, status="unknown", gateway_job_id=False,
        last_error="UNKNOWN_SUBMISSION_OUTCOME: no response",
        gateway_config_id=config, gateway_idempotency_version=1,
        _gateway_idempotency_key=lambda: "original-operation",
    )
    lookup = _method(
        "print_job.py", "PrintGatewayJob", "_lookup_gateway_job_for_ambiguous_submission",
        requests=SimpleNamespace(get=lambda *_args, **_kwargs: response),
        is_exact_gateway_job_id=_runtime_identity(),
    )
    controller = SimpleNamespace(
        _lock_status_row=lambda _job: None,
        _mark_gateway_job_missing=lambda *_args: None,
    )
    assert lookup(controller, job)["jobId"] == identity
    assert saved == [{"gateway_job_id": identity, "next_retry_at": False}]
