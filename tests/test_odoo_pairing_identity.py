"""Execute the production pairing boundary; real ORM companions live in the addon.

Only HTTP and the small assignment storage boundary are substituted here. These
tests are offline regressions, not evidence of native Odoo installation.
"""
import ast
from pathlib import Path
from types import MethodType, SimpleNamespace
from unittest.mock import Mock

import pytest
import requests


class ValidationError(Exception):
    pass


class Assignment(SimpleNamespace):
    def write(self, values):
        self.__dict__.update(values)


class Assignments:
    def __init__(self, records=()):
        self.records = list(records)

    def search(self, domain, limit):
        return next((record for record in self.records
                     if all(getattr(record, key) == value for key, operator, value in domain)), None)

    def create(self, values):
        record = Assignment(**values)
        self.records.append(record)
        return record


def pairing(agents, target="agent-selected", records=()):
    source = Path(__file__).resolve().parents[1] / "odoo_addons/print_gateway/models/gateway_config.py"
    tree = ast.parse(source.read_text())
    cls = next(node for node in tree.body if isinstance(node, ast.ClassDef)
               and node.name == "PrintGatewayPairAgentWizard")
    node = next(node for node in cls.body if isinstance(node, ast.FunctionDef)
                and node.name == "action_confirm_pairing")
    assignments = Assignments(records)

    class Env(dict):
        def is_superuser(self):
            return True

    env = Env({"print_gateway.runtime_agent_assignment": assignments})
    company = SimpleNamespace(id=1, display_name="Company")
    branch = SimpleNamespace(id=2, parent_id=company, display_name="Branch")
    config = SimpleNamespace(company_id=company, gateway_url="https://gateway.invalid",
                             _gateway_base=lambda **kw: "https://gateway.invalid",
                             _gateway_headers=lambda: {})
    response = Mock(status_code=200, content=b"json", json=lambda: {"agents": agents})
    transport = SimpleNamespace(get=Mock(return_value=response), RequestException=requests.RequestException)
    namespace = {"_": lambda text: text, "ValidationError": ValidationError,
                 "AccessError": PermissionError, "requests": transport,
                 "_gateway_redirect_message": lambda *args: None}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])),
                 str(source), "exec"), namespace)
    wizard = SimpleNamespace(ensure_one=lambda: None, agent_id=target,
                             env=env, config_id=config, branch_id=branch)
    wizard.confirm = MethodType(namespace["action_confirm_pairing"], wizard)
    return wizard, assignments


def test_pairing_uses_selected_opaque_id_even_when_another_agent_has_that_name():
    wizard, assignments = pairing([
        {"id": "agent-other", "name": "agent-selected", "lifecycle": "active"},
        {"id": "agent-selected", "name": "Kitchen workstation", "lifecycle": "active"},
    ])
    result = wizard.confirm()
    assert [record.runtime_agent_id for record in assignments.records] == ["agent-selected"]
    assert result["params"]["type"] == "success"


def test_agent_display_name_cannot_authorize_an_assignment_without_the_selected_id():
    wizard, assignments = pairing([
        {"id": "agent-other", "name": "agent-selected", "lifecycle": "active"},
    ])
    with pytest.raises(ValidationError, match="not found"):
        wizard.confirm()
    assert assignments.records == []


def test_repairing_reenables_exact_existing_assignment_without_creating_a_duplicate():
    disabled = Assignment(company_id=1, branch_id=2, runtime_agent_id="agent-selected", enabled=False)
    other_branch = Assignment(company_id=1, branch_id=3, runtime_agent_id="agent-selected", enabled=False)
    wizard, assignments = pairing([
        {"id": "agent-selected", "name": "Kitchen workstation", "lifecycle": "active"},
    ], records=[disabled, other_branch])
    wizard.confirm()
    assert disabled.enabled is True
    assert other_branch.enabled is False
    assert assignments.records == [disabled, other_branch]


@pytest.mark.parametrize("agents", [None, 17, True, "agent-selected", {"id": "agent-selected"}])
def test_malformed_agent_inventory_is_an_actionable_validation_error(agents):
    wizard, assignments = pairing(agents)
    with pytest.raises(ValidationError, match="invalid agent discovery response"):
        wizard.confirm()
    assert assignments.records == []


def test_malformed_inventory_row_cannot_crash_missing_agent_feedback():
    wizard, assignments = pairing([{"id": 17, "lifecycle": "active"}, None])
    with pytest.raises(ValidationError, match="not found"):
        wizard.confirm()
    assert assignments.records == []
