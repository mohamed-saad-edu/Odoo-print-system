"""Keep Gitleaks exclusions narrowly pinned to independently reviewed historical fixtures."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def test_reviewed_gitleaks_history_is_exactly_seventeen_commit_specific_findings():
    lines = (ROOT / ".gitleaksignore").read_text().splitlines()
    fingerprints = [line for line in lines if line and not line.startswith("#")]
    assert len(fingerprints) == len(set(fingerprints)) == 17
    pattern = re.compile(r"^[0-9a-f]{40}:(tests/password-auth-migration\.integration\.test\.ts|docs/runtime-hardening/alpine-security-artifacts\.json|tests/ws-shutdown-drain\.integration\.test\.ts|tests/test_gitleaks_history_baseline\.py):generic-api-key:[0-9]+$")
    assert all(pattern.fullmatch(x) for x in fingerprints)
    by_path = [x.split(":")[1] for x in fingerprints]
    assert by_path.count("tests/password-auth-migration.integration.test.ts") == 1
    assert by_path.count("docs/runtime-hardening/alpine-security-artifacts.json") == 14
    assert by_path.count("tests/ws-shutdown-drain.integration.test.ts") == 1
    assert by_path.count("tests/test_gitleaks_history_baseline.py") == 1
    artifacts = (ROOT / "docs/runtime-hardening/alpine-security-artifacts.json").read_text()
    assert artifacts.count('"key_sha256"') >= 14
    handshake = (ROOT / "tests/ws-shutdown-drain.integration.test.ts").read_text()
    assert '"sec-websocket-key"' in handshake
    assert "exact" in (ROOT / "security/REVIEWED_GITLEAKS_HISTORY.md").read_text().lower()
    assert "1c272b45e9067c50183ac991aae36679ccc0b1e7:tests/test_gitleaks_history_baseline.py:generic-api-key:21" in fingerprints
