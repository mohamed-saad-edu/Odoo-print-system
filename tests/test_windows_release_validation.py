"""Release snapshots need their own tests, even after a previous run is cancelled."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class WindowsReleaseValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = (ROOT / ".github/workflows/build-windows.yml").read_text(encoding="utf-8")
        cls.release = cls.workflow.split("\n  build-windows:\n", 1)[1]
        cls.smoke = cls.workflow.split("\n  windows-pr-smoke:\n", 1)[1].split("\n  build-windows:\n", 1)[0]

    def step(self, name):
        return self.release.split("- name: " + name + "\n", 1)[1].split("\n      - name:", 1)[0]

    def test_installer_cannot_skip_agent_tests_after_a_rust_only_followup(self):
        step = self.step("Verify and test native Windows Go Agent")
        self.assertNotRegex(step, r"(?m)^\s+if:")
        self.assertIn("go test -mod=readonly -race -vet=all ./...", step)
        self.assertIn("Native Windows Go vet/tests failed", step)

    def test_installer_cannot_skip_desktop_tests_after_an_agent_only_followup(self):
        step = self.step("Rust unit tests (desktop)")
        self.assertNotRegex(step, r"(?m)^\s+if:")
        self.assertIn("cargo test --locked --target x86_64-pc-windows-msvc", step)

    def test_prs_still_use_scoped_smoke_without_packaging(self):
        self.assertIn("if: needs.changes.outputs.agent == 'true'", self.smoke)
        self.assertIn("if: needs.changes.outputs.rust == 'true'", self.smoke)
        self.assertNotIn("Build Tauri Windows NSIS installer", self.smoke)

    def test_unrelated_changes_still_skip_the_expensive_release_job(self):
        self.assertIn("if: github.event_name != 'pull_request' && needs.changes.outputs.windows == 'true'", self.release)
        self.assertLess(self.release.index("Verify and test native Windows Go Agent"), self.release.index("Build Tauri Windows NSIS installer"))
        self.assertLess(self.release.index("Rust unit tests (desktop)"), self.release.index("Build Tauri Windows NSIS installer"))


if __name__ == "__main__":
    unittest.main()
