"""Run the production formatter with real requests validation, without Odoo/HTTP."""
import ast
from pathlib import Path

import pytest
import requests


def formatter():
    source = Path(__file__).resolve().parents[1] / "odoo_addons/print_gateway/models/gateway_config.py"
    tree = ast.parse(source.read_text())
    helper = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_friendly_gateway_request_error")
    namespace = {"requests": requests}
    exec(compile(ast.Module(body=[helper], type_ignores=[]), str(source), "exec"), namespace)
    return namespace[helper.name]


@pytest.mark.parametrize("key", ["test-credential\ncontinued", "test-credential\r\nX-Injected: yes"])
def test_invalid_authorization_header_never_discloses_credential(key):
    # prepare() validates locally: no Session.send/network interaction occurs.
    with pytest.raises(requests.exceptions.InvalidHeader) as caught:
        requests.Request("GET", "https://gateway.example.test/api/odoo/status",
                         headers={"Authorization": "Bearer " + key}).prepare()
    assert "test-credential" in str(caught.value), "fixture must exercise requests header disclosure"
    message = formatter()(caught.value, "https://gateway.example.test")
    assert "test-credential" not in message
    assert "InvalidHeader" in message
    assert "https://gateway.example.test" in message


def test_connection_and_timeout_messages_keep_operator_diagnostics():
    helper = formatter()
    assert "Connection refused" in helper(requests.exceptions.ConnectionError("Connection refused"), "https://gateway.example.test")
    assert "Read timeout" in helper(requests.exceptions.Timeout("Read timeout"), "https://gateway.example.test")


class SafeCredentialError(Exception):
    pass


def credential_readers(key):
    """Execute both production decryption entrypoints; substitute only ORM/crypto."""
    source = Path(__file__).resolve().parents[1] / "odoo_addons/print_gateway/models/gateway_config.py"
    tree = ast.parse(source.read_text())
    model = next(node for node in tree.body if isinstance(node, ast.ClassDef)
                 and any(isinstance(child, ast.FunctionDef) and child.name == "_gateway_headers"
                         for child in node.body))
    methods = [node for node in model.body if isinstance(node, ast.FunctionDef)
               and node.name in {"_gateway_api_key_plaintext_from_value", "_gateway_api_key_plaintext"}]
    helpers = [node for node in tree.body if isinstance(node, ast.FunctionDef)
               and node.name == "_validated_gateway_api_key_header"]
    namespace = {"requests": requests, "ValidationError": SafeCredentialError,
                 "CredentialKeyUnavailable": type("KeyUnavailable", (Exception,), {}),
                 "CredentialDecryptError": type("DecryptFailure", (Exception,), {}),
                 "decrypt_gateway_api_key": lambda value: value, "_": lambda value: value}
    for method in methods:
        method.decorator_list = []
    exec(compile(ast.Module(body=helpers + methods, type_ignores=[]), str(source), "exec"), namespace)
    record = type("CredentialRecord", (), {
        "gateway_api_key": key, "ensure_one": lambda self: None,
        "_protected_gateway_api_key": lambda self, value: value,
    })()
    return namespace, record


@pytest.mark.parametrize("reader", ["_gateway_api_key_plaintext_from_value", "_gateway_api_key_plaintext"])
@pytest.mark.parametrize("key", ["test-credential\ncontinued", "test-credential\r\nX-Injected: yes"])
def test_all_plaintext_readers_refuse_unsafe_credentials_without_echoing_them(reader, key):
    namespace, record = credential_readers(key)
    args = (record, key) if reader.endswith("from_value") else (record,)
    with pytest.raises(SafeCredentialError) as caught:
        namespace[reader](*args)
    assert "test-credential" not in str(caught.value)
    assert "credential" in str(caught.value).lower()


@pytest.mark.parametrize("reader", ["_gateway_api_key_plaintext_from_value", "_gateway_api_key_plaintext"])
def test_valid_credentials_remain_byte_identical_in_all_plaintext_readers(reader):
    key = "odoo_test-credential_123"
    namespace, record = credential_readers(key)
    args = (record, key) if reader.endswith("from_value") else (record,)
    assert namespace[reader](*args) == key
