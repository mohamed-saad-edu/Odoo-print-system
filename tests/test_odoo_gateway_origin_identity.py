"""Execute the config write boundary against real external identity files.

The ORM alone is substituted by the existing config-write harness. These
regressions prove that cosmetic URL edits cannot rotate a saved installation
or queue a shutdown of the very same Gateway endpoint. Native Odoo tests cover
that method's ORM integration separately.
"""
import ast
import importlib.util
from pathlib import Path

import pytest

import test_odoo_config_key_rotation_f015 as write_harness
from test_s06_versioned_keys import impl as identity_module

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'odoo_addons/print_gateway/models/gateway_config.py'


def endpoint_comparator():
    destination_file = CONFIG.with_name('gateway_destination.py')
    spec = importlib.util.spec_from_file_location('gateway_destination_under_test', destination_file)
    destination = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(destination)
    tree = ast.parse(CONFIG.read_text())
    helper = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                  and node.name == '_same_gateway_endpoint')
    namespace = {
        'canonical_origin': destination.canonical_origin,
        'PrintGatewayConfig': type('Config', (), {'_validate_gateway_url': staticmethod(lambda value: value)}),
    }
    exec(compile(ast.Module(body=[helper], type_ignores=[]), str(CONFIG), 'exec'), namespace)
    return namespace['_same_gateway_endpoint']


@pytest.mark.parametrize('old_url,new_url', [
    ('https://gateway.example.com', 'https://GATEWAY.EXAMPLE.COM'),
    ('https://GATEWAY.EXAMPLE.COM', 'https://gateway.example.com'),
    ('https://gateway.example.com', 'https://gateway.example.com:443'),
    ('https://gateway.example.com:443', 'https://gateway.example.com'),
    ('https://gateway.example.com', 'https://gateway.example.com.'),
    ('https://gateway.example.com', 'https://gateway.example.com/'),
])
def test_equivalent_url_save_preserves_external_installation_and_pending_jobs(old_url, new_url, tmp_path, monkeypatch):
    monkeypatch.setitem(write_harness.namespace, '_same_gateway_endpoint', endpoint_comparator())
    config = write_harness.config()
    config.gateway_url = old_url
    identity = identity_module()
    before = identity.local_identity('fixture', config.gateway_url, tmp_path, company_id=7)
    config.installation_id = before['installationId']
    config.idempotency_v2_enabled = True
    saved_wire_key = identity.wire_key(2, 7, 'order-42', config.installation_id)

    config.write({'gateway_url': new_url})

    after = identity.local_identity('fixture', config.gateway_url, tmp_path, company_id=7)
    assert after == before, 'A cosmetic URL edit rotated the installation proof used by saved jobs'
    assert config.installation_id == before['installationId']
    assert config.idempotency_v2_enabled is True
    assert identity.wire_key(2, 7, 'order-42', config.installation_id) == saved_wire_key
    assert config.pending_disable_gateway_url is False
    assert config.enabled_sync_revision == 5
    assert config.queued == []


@pytest.mark.parametrize('left,right', [
    ('https://gateway.example.com', 'https://other.example.com'),
    ('https://gateway.example.com', 'https://gateway.example.com:8443'),
    ('https://gateway.example.com', 'http://gateway.example.com'),
    ('https://gateway.example.com', 'https://gateway.example.com.evil.invalid'),
    ('https://gateway.example.com', 'https://gateway.example.com/private'),
])
def test_distinct_or_invalid_origins_never_bypass_shutdown(left, right):
    assert endpoint_comparator()(left, right) is False


def test_actual_endpoint_change_keeps_shutdown_and_reenrollment_fences(monkeypatch):
    monkeypatch.setitem(write_harness.namespace, '_same_gateway_endpoint', endpoint_comparator())
    config = write_harness.config()
    config.installation_id = '00000000-0000-4000-8000-000000000001'
    config.idempotency_v2_enabled = True
    config.write({'gateway_url': 'https://different.example.com'})
    assert config.pending_disable_gateway_url == 'https://gateway.fixture.invalid'
    assert config.installation_id is False
    assert config.idempotency_v2_enabled is False
    assert config.enabled_sync_revision == 6
