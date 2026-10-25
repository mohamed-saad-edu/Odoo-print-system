"""Real controller-method exercises with an isolated Odoo recordset stand-in.

These tests execute the controller's source AST, not a copied implementation.
They are NOT a substitute for an Odoo 19 database/browser asset test.
"""
import ast
import copy
from pathlib import Path
from types import SimpleNamespace
from xml.etree import ElementTree

import pytest


ROOT = Path(__file__).resolve().parents[1]
CONTROLLER = ROOT / "odoo_addons/print_gateway/controllers/runtime_printers.py"
VIEW = ROOT / "odoo_addons/print_gateway/static/src/components/printers_overview.xml"


class Forbidden(Exception):
    pass


class ValidationError(Exception):
    pass


class Company:
    def __init__(self, id_, name, parent=None):
        self.id, self.name, self.display_name, self.parent_id = id_, name, name, parent


class Companies:
    def __init__(self, by_id):
        self.by_id = by_id

    def browse(self, id_):
        return SimpleNamespace(exists=lambda: self.by_id.get(id_, False))


class Environment:
    def __init__(self, companies, current):
        self.companies = companies
        self.company = current
        self.model = Companies({company.id: company for company in companies})
        self._ = lambda message: message

    def __getitem__(self, name):
        assert name == "res.company"
        return self.model


def controller_under_test(env):
    tree = ast.parse(CONTROLLER.read_text(encoding="utf8"))
    original = next(node for node in tree.body if isinstance(node, ast.ClassDef)
                    and node.name == "PrintGatewayRuntimePrinterController")
    methods = []
    for node in original.body:
        if isinstance(node, ast.FunctionDef) and node.name in {"setup_context", "_scope"}:
            cloned = copy.deepcopy(node)
            cloned.decorator_list = []
            methods.append(cloned)
    assert len(methods) == 2
    class_node = ast.ClassDef(name="ActualController", bases=[], keywords=[], body=methods,
                              decorator_list=[])
    isolated = ast.fix_missing_locations(ast.Module(body=[class_node], type_ignores=[]))
    namespace = {"Forbidden": Forbidden, "ValidationError": ValidationError,
                 "request": SimpleNamespace(env=env)}
    exec(compile(isolated, str(CONTROLLER), "exec"), namespace)
    klass = namespace["ActualController"]
    klass._require_runtime_admin = lambda self: None
    klass._get_config = lambda self, company: (SimpleNamespace(id=company.id * 10), company)
    return klass()


def test_duplicate_names_and_user_supplied_suffixes_never_collide():
    a = Company(1, "My Company")
    b = Company(2, "My Company")
    c = Company(3, "My Company (#2)")
    controller = controller_under_test(Environment([a, b, c], a))
    result = controller.setup_context()
    labels = [scope["name"] for scope in result["scopes"]]
    assert len(set(name.casefold() for name in labels)) == 3
    assert [scope["id"] for scope in result["scopes"]] == [1, 2, 3]
    assert all(scope["companyId"] == scope["id"] for scope in result["scopes"])


def test_four_same_name_authorized_branches_preserve_exact_routing_identities():
    root = Company(101, "My Company")
    branch_a = Company(201, "My Company", root)
    branch_b = Company(202, "My Company", root)
    branch_c = Company(203, "My Company", root)
    nested = Company(301, "My Company", branch_a)
    env = Environment([root, branch_a, branch_b, branch_c, nested, branch_a], root)
    result = controller_under_test(env).setup_context()
    scopes = result["scopes"]
    assert [row["id"] for row in scopes] == [101, 201, 202, 203, 301]
    assert len({row["name"].casefold() for row in scopes}) == 5
    assert [(row["companyId"], row["branchId"]) for row in scopes] == [
        (101, False), (101, 201), (101, 202), (101, 203), (101, 301),
    ]
    assert "My Company / My Company / My Company" in scopes[-1]["name"]
    assert scopes[-1]["assignable"] is False
    assert all(row.get("assignable", True) for row in scopes[:-1])


@pytest.mark.parametrize("bad", [True, 1.8, "1.0", " 1", -1, "", [], {}, 2**70])
def test_explicit_company_scope_rejects_ambiguous_rpc_ids(bad):
    root = Company(1, "Root")
    controller = controller_under_test(Environment([root], root))
    with pytest.raises(Forbidden):
        controller._scope(company_id=bad)


def test_explicit_branch_scope_rejects_fractional_rpc_ids():
    root, branch = Company(1, "Root"), Company(2, "Branch")
    branch.parent_id = root
    controller = controller_under_test(Environment([root, branch], root))
    with pytest.raises(Forbidden):
        controller._scope(company_id=1, branch_id=2.9)
    assert controller._scope(company_id="1", branch_id="2") == (root, branch)


def test_visual_selected_option_tracks_authorized_internal_scope_not_first_row():
    root = ElementTree.parse(VIEW).getroot()
    select = next(element for element in root.iter("select") if element.attrib.get("id") == "pg_inventory_scope")
    options = list(select.iter("option"))
    placeholder = options[0]
    scope_option = next(option for option in options if "t-foreach" in option.attrib)
    assert placeholder.attrib.get("t-att-selected") == "state.scopeId === 0"
    assert scope_option.attrib.get("t-att-selected") == "scope.id === state.scopeId"


def test_agent_selector_selected_option_tracks_selected_agent():
    root = ElementTree.parse(VIEW).getroot()
    select = next(element for element in root.iter("select") if element.attrib.get("id") == "pg_inventory_agent")
    options = list(select.iter("option"))
    assert options[0].attrib.get("t-att-selected") == "!state.agentId"
    assert options[1].attrib.get("t-att-selected") == "agent.id === state.agentId"
