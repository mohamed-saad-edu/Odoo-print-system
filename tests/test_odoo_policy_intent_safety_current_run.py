"""Offline executable Odoo policy safety regressions without an Odoo installation.

Compile the actual implementation's restricted methods from the addon AST;
exercise them with small record fixtures and inspect the transaction boundary.
"""
import ast
import copy
import logging
import xml.etree.ElementTree as ET
from pathlib import Path
from types import SimpleNamespace

import pytest

BASE = Path(__file__).resolve().parents[1] / 'odoo_addons' / 'print_gateway' / 'models'


class ValidationError(Exception):
    pass


def _class_methods(file, cls_name, method_names, extra=None):
    source = ast.parse((BASE / file).read_text(encoding='utf-8'))
    klass = next(n for n in source.body if isinstance(n, ast.ClassDef) and n.name == cls_name)
    methods = []
    for method in klass.body:
        if isinstance(method, ast.FunctionDef) and method.name in method_names:
            method = copy.deepcopy(method)
            method.decorator_list = []
            methods.append(method)
    assert len(methods) == len(method_names), method_names
    extracted = ast.Module(body=[ast.ClassDef(name='Target', bases=[], keywords=[], body=methods, decorator_list=[])], type_ignores=[])
    ast.fix_missing_locations(extracted)
    namespace = {'ValidationError': ValidationError, '_': lambda v: v, '_logger': logging.getLogger(__name__)}
    namespace.update(extra or {})
    exec(compile(extracted, str(BASE/file), 'exec'), namespace)
    return namespace['Target']


class _PolicyRecords(list):
    VALID_MODEL_EVENTS = {'account.move': {'invoice_posted'}}


def _report_policy(binding_report_id):
    policy_type = _class_methods(
        'print_policy.py', 'PrintGatewayPolicy', {'_check_action_configuration'},
    )
    expected = SimpleNamespace(id=31, model='account.move', display_name='Invoice PDF')
    actual = SimpleNamespace(id=binding_report_id, model='account.move', display_name='Other PDF')
    return policy_type, SimpleNamespace(
        model_name='account.move', event_type='invoice_posted', action_type='report',
        report_id=expected, raw_template=False, domain_filter=False,
        binding_id=SimpleNamespace(report_id=expected if binding_report_id == 31 else actual,
                                   display_name='Invoice printer rule'),
    )


def test_report_policy_rejects_another_report_on_the_same_model_before_dispatch():
    policy_type, policy = _report_policy(32)
    with pytest.raises(ValidationError) as error:
        policy_type._check_action_configuration(_PolicyRecords([policy]))
    assert 'Invoice printer rule' in str(error.value)
    assert 'Invoice PDF' in str(error.value)


def test_report_policy_keeps_matching_explicit_and_automatic_targets():
    policy_type, policy = _report_policy(31)
    policy_type._check_action_configuration(_PolicyRecords([policy]))
    policy.binding_id = False
    policy_type._check_action_configuration(_PolicyRecords([policy]))


def test_automation_form_filters_report_rules_without_widening_company_scope():
    view = ET.parse(BASE.parent / 'views/print_policy_views.xml')
    expression = view.find(".//field[@name='binding_id'][@domain]").attrib['domain']
    scope = {'company_id': 1, 'branch_id': 2, 'report_id': 31, 'action_type': 'report'}
    domain = eval(expression, {'__builtins__': {}}, scope)
    assert ('report_id', '=', 31) in domain
    assert ('company_id', '=', 1) in domain
    assert ('branch_id', '=', 2) in domain
    assert ('branch_id', '=', False) in domain
    scope['action_type'] = 'raw_template'
    assert ('report_id', '=', 31) not in eval(expression, {'__builtins__': {}}, scope)


def test_pending_retry_does_not_claim_to_be_waiting_for_business_commit():
    view = ET.parse(BASE.parent / 'views/print_intent_views.xml')
    commit, retry = [node for node in view.iter('div') if 'attempts' in node.attrib.get('invisible', '')]
    for attempts, visible in [(0, commit), (2, retry)]:
        context = {'status': 'pending', 'attempts': attempts}
        for node in (commit, retry):
            assert (not eval(node.attrib['invisible'], {'__builtins__': {}}, context)) == (node is visible)


def test_branch_only_context_can_validate_its_binding_without_activating_parent():
    binding_type = _class_methods('binding.py', 'PrintGatewayBinding', {'_check_runtime_scope'})
    root = SimpleNamespace(id=1)
    branch = SimpleNamespace(id=2, parent_id=root)
    assignment = SimpleNamespace(is_agent_assigned=lambda *args: True)
    class ScopeEnv(dict):
        companies = [branch]
    records = _PolicyRecords([SimpleNamespace(company_id=root, branch_id=branch,
                                              runtime_agent_id='branch-agent')])
    records.env = ScopeEnv({'print_gateway.runtime_agent_assignment': assignment})
    binding_type._check_runtime_scope(records)


def test_branch_only_administrator_can_validate_its_runtime_assignment():
    assignment_type = _class_methods('runtime_assignment.py', 'PrintGatewayRuntimeAgentAssignment', {'_check_assignment'})
    root = SimpleNamespace(id=1, parent_id=False)
    branch = SimpleNamespace(id=2, parent_id=root)
    records = _PolicyRecords([SimpleNamespace(company_id=root, branch_id=branch,
                                              runtime_agent_id='branch-agent')])
    records.env = SimpleNamespace(user=SimpleNamespace(company_ids=[branch]))
    assignment_type._check_assignment(records)


def _harness(template):
    functions = ast.parse((BASE / 'print_policy.py').read_text(encoding='utf-8'))
    sanitizer = next(n for n in functions.body if isinstance(n, ast.FunctionDef) and n.name == 'sanitize_raw_value')
    exported = ast.Module(body=[sanitizer], type_ignores=[])
    ast.fix_missing_locations(exported)
    globals_ = {}
    exec(compile(exported, 'print_policy.py', 'exec'), globals_)
    policy_class = _class_methods('print_policy.py', 'PrintGatewayPolicy',
                                  {'_sanitize_template_field', 'render_raw_template'}, globals_)
    policy = policy_class()
    policy.ensure_one = lambda: None
    policy.raw_template = template
    policy.raw_protocol = 'zpl'
    policy.name = 'Test labels'
    return policy


class Record:
    _fields = {
        'name': SimpleNamespace(type='char'),
        'expensive': SimpleNamespace(type='char'),
        'partner_id': SimpleNamespace(type='many2one'),
        'balance': SimpleNamespace(type='float'),
    }

    def __init__(self):
        self.reads = []

    def __getattr__(self, key):
        self.reads.append(key)
        if key == 'expensive':
            raise AssertionError('unreferenced expensive computed field read')
        values = {'name': 'test^~NAME', 'partner_id': SimpleNamespace(display_name='Alice', id=71), 'balance': 123.45}
        return values[key]


def test_template_reads_only_requested_fields_and_sanitizes_value():
    record = Record()
    assert _harness('^XA^FD{name}^FS^XZ').render_raw_template(record) == '^XA^FDtestNAME^FS^XZ'
    assert record.reads == ['name']


def test_many2one_display_and_id_access_do_not_touch_other_fields():
    record = Record()
    assert _harness('{partner_id}|{partner_id_id}').render_raw_template(record) == 'Alice|71'
    assert record.reads == ['partner_id', 'partner_id']


@pytest.mark.parametrize('template', [
    '{name:>9999999999}',
    '{name:.500000000}',
    '{name:{expensive}}',
    '{name.__class__}',
    '{name!r}',
    '{expensive[0]}',
    '{0}',
    '{}',
])
def test_template_rejects_unsafe_formatting_before_reading_record(template):
    record = Record()
    with pytest.raises(ValidationError):
        _harness(template).render_raw_template(record)
    assert not record.reads


def test_unknown_field_returns_operator_diagnostic():
    with pytest.raises(ValidationError, match='missing_field'):
        _harness('{missing_field}').render_raw_template(Record())


def test_raw_template_length_is_bounded_before_record_access():
    record = Record()
    with pytest.raises(ValidationError, match='2 MiB'):
        _harness('X' * (2*1024*1024 + 1)).render_raw_template(record)
    assert not record.reads


def test_each_business_policy_hook_catches_only_after_savepoint():
    for file, cls_name, method in (
        ('account_move.py', 'AccountMovePrintGateway', 'action_post'),
        ('stock_picking.py', 'StockPickingPrintGateway', '_action_done'),
        ('pos_order.py', 'PosOrderGatewayPrinting', '_action_trigger_print_policies'),
    ):
        module = ast.parse((BASE / file).read_text(encoding='utf-8'))
        cls = next(n for n in module.body if isinstance(n, ast.ClassDef) and n.name == cls_name)
        handler = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == method)
        calls = [n for n in ast.walk(handler) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                 and n.func.attr == 'dispatch_for_record']
        assert len(calls) == 1
        savepoints = [n for n in ast.walk(handler) if isinstance(n, ast.With) and
                      any(isinstance(v.context_expr, ast.Call) and isinstance(v.context_expr.func, ast.Attribute)
                          and v.context_expr.func.attr == 'savepoint' for v in n.items)]
        assert len(savepoints) == 1
        assert any(call in list(ast.walk(savepoints[0])) for call in calls)
        assert any(isinstance(n, ast.Try) and savepoints[0] in list(ast.walk(n))
                   for n in ast.walk(handler))


def test_intent_route_requires_durable_job_or_explicit_skip_and_savepoint():
    tree = ast.parse((BASE / 'print_intent.py').read_text(encoding='utf-8'))
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'PrintGatewayIntent')
    route = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == '_execute_dispatched_route')
    savepoints = [n for n in ast.walk(route) if isinstance(n, ast.With) and
                  any(isinstance(i.context_expr, ast.Call) and isinstance(i.context_expr.func, ast.Attribute)
                      and i.context_expr.func.attr == 'savepoint' for i in n.items)]
    assert len(savepoints) == 1
    assert any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
               and n.func.attr == 'route_intent' for n in ast.walk(savepoints[0]))
    assert any(isinstance(n, ast.Raise) and isinstance(n.exc, ast.Call)
               and isinstance(n.exc.func, ast.Name) and n.exc.func.id == 'ValueError'
               for n in ast.walk(savepoints[0]))
