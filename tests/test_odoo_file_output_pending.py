"""Odoo file-output projection contract, without booting Odoo."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import pytest

path = Path(__file__).resolve().parents[1] / "odoo_addons/print_gateway/print_output.py"
spec = importlib.util.spec_from_file_location("yaseir_file_projection", path)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)

@pytest.mark.parametrize("status", ["queued", "submitted", "claimed", "printing"])
def test_in_flight_file_stays_pending(status):
    job = SimpleNamespace(output_medium=False, output_evidence=False)
    result = module.gateway_output_values(job, {"outputMedium": "file", "outputOutcome": "pending"}, status)
    assert result == {"output_medium": "file", "output_outcome": "pending", "output_evidence": False}

@pytest.mark.parametrize("status", ["success", "failed", "unknown"])
def test_terminal_without_artifact_is_not_pending(status):
    job = SimpleNamespace(output_medium=False, output_evidence=False)
    result = module.gateway_output_values(job, {"outputMedium": "file", "outputOutcome": "pending"}, status)
    assert result["output_outcome"] == "unknown"
    assert result["output_evidence"] is False
