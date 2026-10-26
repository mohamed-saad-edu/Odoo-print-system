"""Exercise the real outbox exception classifier without Odoo or sockets."""
import ast
from pathlib import Path

import pytest
import requests


def classify(error):
    path = Path(__file__).resolve().parents[1] / 'odoo_addons/print_gateway/models/print_job.py'
    tree = ast.parse(path.read_text())
    method = next(node for node in ast.walk(tree)
                  if isinstance(node, ast.FunctionDef) and node.name == '_is_pre_dispatch_error')
    method.decorator_list = []
    namespace = {}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[method], type_ignores=[])), str(path), 'exec'), namespace)
    return namespace[method.name](None, error)


@pytest.mark.parametrize('connect_first', [True, False])
def test_ambiguous_phase_dominates_other_connection_evidence(connect_first):
    read_error = type('ReadTimeoutError', (Exception,), {})('response not received')
    connect_error = ConnectionRefusedError('previous address refused')
    # A wrapper can retain several urllib3 errors; traversal order must not
    # authorize a backup physical destination after any uncertain dispatch.
    errors = (connect_error, read_error) if connect_first else (read_error, connect_error)
    assert classify(Exception(*errors)) is False


@pytest.mark.parametrize('phase_error', [
    'ReadTimeoutError', 'ReadTimeout', 'ChunkedEncodingError', 'ContentDecodingError',
])
def test_old_connection_context_cannot_hide_current_response_timeout(phase_error):
    wrapper = Exception('request failed')
    wrapper.__cause__ = type(phase_error, (Exception,), {})('after send')
    wrapper.__context__ = ConnectionRefusedError('older attempt')
    assert classify(wrapper) is False


def test_genuine_connection_failure_and_cycle_are_safe():
    wrapper = Exception(ConnectionRefusedError('no bytes sent'))
    wrapper.__context__ = wrapper
    assert classify(wrapper) is True
    assert classify(Exception('unclassified')) is False


def test_unspecified_request_timeout_cannot_authorize_failover():
    # Requests' base Timeout does not prove whether bytes were sent. Retained
    # connect-phase context from an earlier attempt cannot supply that proof.
    error = requests.exceptions.Timeout('request phase is unknown')
    error.__context__ = ConnectionRefusedError('older connection attempt')
    assert classify(error) is False
