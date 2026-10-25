"""Standalone invariants until native Odoo 19 tests can run."""
from pathlib import Path

ADDON = Path(__file__).resolve().parents[1] / "odoo_addons/print_gateway"


def test_nested_branch_must_not_be_auto_routed_as_root_or_active_assignment():
    controller = (ADDON / "controllers/runtime_printers.py").read_text()
    picker = (ADDON / "static/src/components/printers_overview.xml").read_text()
    assert "'assignable': False" in controller
    assert "if company.parent_id and company.parent_id.parent_id:" in controller
    assert 'Nested Odoo branches are not supported for printer assignments.' in controller
    assert 't-att-disabled="scope.assignable === false"' in picker
    assert 'value="0" disabled="disabled"' in picker


def test_picker_clears_stale_scope_and_honors_action_branch():
    source = (ADDON / "static/src/components/printers_overview.js").read_text()
    assert "requestedBranchId: this.props.action?.context?.default_branch_id" in source
    assert "this.state.scopeId = selected.id" in source
    assert "selected.invalidated" in source
    assert "this.state.scopes[0]?.id" not in source
