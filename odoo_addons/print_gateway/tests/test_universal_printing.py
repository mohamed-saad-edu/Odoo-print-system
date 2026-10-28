"""Native Odoo/PG approved file output, result persistence and current eligibility."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch
import secrets

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import tagged
from odoo.tests.common import TransactionCase

from .printer_fixtures import verified_printer


@tagged("post_install", "-at_install")
class TestUniversalPrinting(TransactionCase):
    def _printer(self):
        return verified_printer({"id": "file-printer", "connectionType": "pdf_output", "protocol": "pdf",
            "lifecycle": "active", "sharedWithGateway": True, "agent": {"id": "agent-file"}, "deviceClass": "other",
            "capabilities": {"geometry": {"version": 1, "source": "validated_profile", "validation": "configured",
                "observed_at": "2026-10-24T00:00:00Z", "printer_id": "file-printer", "config_fingerprint": "b" * 64,
                "paper_width_mm": 210, "paper_height_mm": 297, "printable_width_dots": 2244,
                "printable_height_dots": 3271, "dpi_x": 300, "dpi_y": 300, "offset_x_dots": 118, "offset_y_dots": 118}}})

    def _binding(self):
        return self.env["print_gateway.binding"].new({"company_id": self.env.company.id, "runtime_agent_id": "agent-file",
            "printer_id": "file-printer", "printer_protocol": "pdf", "destination_type": "pos"})

    def _runtime(self, printer):
        binding = self._binding()
        config = SimpleNamespace(company_id=self.env.company, _gateway_base=lambda **_kw: "https://fixture.invalid", _gateway_headers=lambda: {})
        bodies = iter([{"agents": [{"id": "agent-file", "lifecycle": "active"}]}, {"printers": [printer]}])
        with patch.object(type(binding), "_get_gateway_config", return_value=config), \
             patch.object(type(self.env["print_gateway.runtime_agent_assignment"]), "is_agent_assigned", return_value=True), \
             patch("odoo.addons.print_gateway.models.binding.requests.get", side_effect=lambda *_a, **_kw: SimpleNamespace(status_code=200, json=lambda: next(bodies))):
            return binding._validate_runtime_target()

    def _job(self):
        Config = self.env["print_gateway.gateway_config"]
        with patch.object(type(Config), "_validate_gateway_host"), patch.object(type(Config), "_register_auto_installation", return_value="synthetic"):
            config = Config.search([("company_id", "=", self.env.company.id)], limit=1) or Config.create({
                "company_id": self.env.company.id, "gateway_url": "https://fixture.invalid", "gateway_api_key": secrets.token_urlsafe(32)})
        job = self.env["print_gateway.print_job"].sudo().create({"company_id": self.env.company.id, "gateway_config_id": config.id,
            "printer_id": "file-printer", "destination": "File output test", "document_type": "receipt",
            "idempotency_key": secrets.token_hex(16), "payload": '{"type":"pdf","encoding":"base64","data":"fixture"}'})
        job._advance_status(job, "printing", {"gateway_job_id": "remote-file-original", "output_medium": "file"})
        return job

    def _body(self):
        return {"jobId": "remote-file-original", "status": "success", "outputMedium": "file", "outputOutcome": "file_created",
                "outputEvidence": {"output_medium": "file", "artifact_id": "file_native_fixture", "sha256": "c" * 64, "page_count": 2, "bytes": 4096}}

    def test_actual_binding_accepts_verified_file_destination_for_receipt_and_kitchen(self):
        printer = self._printer()
        self.assertEqual(self._runtime(printer)["outputMedium"], "file")
        for destination in ("pos", "pos_printer"):
            binding = self._binding()
            binding.destination_type = destination
            self.assertTrue(binding._runtime_printer_accepts_image(printer))
            self.assertEqual(binding._canonical_runtime_printer_protocol(printer), "pdf")
            self.assertTrue(binding._validate_binding_protocol_against_runtime(printer))

    def test_current_registration_does_not_authorize_missing_expired_or_mismatched_proof(self):
        for mutation in ("pending", "expired", "other-printer", "other-medium"):
            printer = self._printer()
            if mutation == "pending":
                printer["verificationState"] = "pending"
            elif mutation == "expired":
                printer["verificationReceivedAt"] = (datetime.now(timezone.utc) - timedelta(seconds=301)).isoformat().replace("+00:00", "Z")
            elif mutation == "other-printer":
                printer["capabilities"]["operational_verification"]["printer_id"] = "another-printer"
            else:
                printer["outputMedium"] = "physical"
            with self.subTest(mutation=mutation), self.assertRaises(ValidationError):
                self._runtime(printer)

    def test_file_image_requires_explicit_complete_page_boundaries(self):
        for key in ("paper_height_mm", "printable_height_dots", "offset_x_dots", "offset_y_dots", "dpi_y"):
            printer = self._printer()
            del printer["capabilities"]["geometry"][key]
            with self.subTest(key=key):
                self.assertFalse(self._binding()._runtime_printer_accepts_image(printer))

    def test_gateway_submission_status_never_hides_ambiguous_physical_output(self):
        job = self.env["print_gateway.print_job"]
        cases = [
            ("partial", "paper may have left", "unknown", "UNKNOWN_PARTIAL_DELIVERY:"),
            ("unexpected_future_state", None, "unknown", "UNKNOWN_SUBMISSION_OUTCOME:"),
            ("failed", "AGENT_EXECUTION_TIMEOUT: no final report", "unknown", "AGENT_EXECUTION_TIMEOUT:"),
            ("unknown", None, "unknown", "UNKNOWN_SUBMISSION_OUTCOME:"),
            ("completed", None, "success", None),
            ("claimed", None, "claimed", None),
            ("queued", None, "submitted", None),
        ]
        for remote_status, remote_error, expected, marker in cases:
            with self.subTest(remote_status=remote_status, remote_error=remote_error):
                classified, reason = job._classify_gateway_submission_status(remote_status, remote_error)
                self.assertEqual(classified, expected)
                if marker:
                    self.assertTrue(str(reason).startswith(marker), reason)
                else:
                    self.assertFalse(reason)

    def test_actual_sync_persists_verified_file_without_claiming_physical_print(self):
        job, body = self._job(), self._body()
        self.assertTrue(job._apply_synced_status(job, body))
        job.flush_recordset()
        job.invalidate_recordset()
        self.assertEqual(job.status, "success")
        self.assertEqual(job.output_evidence, body["outputEvidence"])
        self.assertEqual(job.output_outcome, "file_created")
        self.assertEqual(job.physical_outcome, "unknown")
        result = self.env["print_gateway.print_router"]._durable_submission_outcome(job)
        self.assertEqual(result["gateway_job_id"], body["jobId"])
        self.assertEqual(result["outputEvidence"], body["outputEvidence"])
        self.assertIn("file", result["message"].lower())
        self.assertNotIn("paper", result["message"].lower())

    def test_verified_file_result_cannot_be_replaced_or_erased(self):
        job, body = self._job(), self._body()
        job._apply_synced_status(job, body)
        changed = deepcopy(body)
        changed["outputEvidence"]["sha256"] = "d" * 64
        with self.assertRaises(ValueError):
            job._apply_synced_status(job, changed)
        for values in ({"output_evidence": False}, {"output_medium": "physical"}, {"output_outcome": "unknown"}):
            with self.subTest(values=values), self.assertRaises(ValidationError):
                job.write(values)
        self.assertEqual(job.output_evidence, body["outputEvidence"])

    def test_invalid_file_evidence_never_becomes_verified(self):
        job, body = self._job(), self._body()
        body["outputEvidence"]["path"] = "/private/forbidden.pdf"
        job._apply_synced_status(job, body)
        self.assertEqual(job.output_outcome, "unknown")
        self.assertFalse(job.output_evidence)

    def test_ordinary_company_user_cannot_forge_file_result(self):
        job = self._job()
        user = self.env["res.users"].create({"name": "File evidence viewer", "login": "file-proof-" + secrets.token_hex(8),
            "company_id": self.env.company.id, "company_ids": [(6, 0, self.env.company.ids)],
            "group_ids": [(6, 0, [self.env.ref("base.group_user").id])]})
        with self.assertRaises(AccessError):
            job.with_user(user).write({"output_evidence": self._body()["outputEvidence"], "output_outcome": "file_created"})
