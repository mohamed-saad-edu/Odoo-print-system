"""Real ORM guards for service-created work (ODOO-2026-001).

These tests require the Odoo 19/PostgreSQL addon test runner. They do not submit
HTTP requests or print; the runtime-independent tests live under tests/.
"""
import json
import os
import tempfile
from unittest.mock import Mock, patch

from odoo.exceptions import AccessError
from odoo.tests import tagged
from odoo.tests.common import TransactionCase
from odoo.addons.print_gateway.idempotency_namespace import deployment_proof


@tagged("post_install", "-at_install")
class TestDurableIdentitySecurity(TransactionCase):
    def setUp(self):
        super().setUp()
        self.root = self.env.company
        self.branch = self.env["res.company"].create({
            "name": "Durable Identity Branch", "parent_id": self.root.id,
        })
        self.other = self.env["res.company"].create({"name": "Durable Identity Other Company"})
        self.foreign_config = self.env["print_gateway.gateway_config"].sudo().create({
            "company_id": self.other.id, "gateway_url": "https://gateway.example.com",
            "enabled": False,
        })
        self.operator = self.env["res.users"].create({
            "name": "Durable Identity Branch Admin", "login": "durable_identity_branch_admin",
            "company_id": self.branch.id, "company_ids": [(6, 0, [self.branch.id])],
            "group_ids": [(6, 0, [self.env.ref("base.group_user").id,
                                     self.env.ref("base.group_system").id])],
        })
        self.jobs = self.env["print_gateway.print_job"].with_user(self.operator).with_context(
            allowed_company_ids=[self.branch.id],
        )
        self.intents = self.env["print_gateway.intent"].with_user(self.operator).with_context(
            allowed_company_ids=[self.branch.id],
        )
        self.job_values = {
            "company_id": self.branch.id, "gateway_config_id": self.foreign_config.id,
            "printer_id": "foreign-printer", "destination": "Forged destination",
            "document_type": "invoice", "idempotency_key": "durable-identity-forged",
            "payload": json.dumps({"type": "pdf", "encoding": "base64", "data": "JVBERi0xLjQKJSVFT0Y="}),
        }

    def test_branch_admin_cannot_create_outbox_with_foreign_configuration(self):
        with self.assertRaises(AccessError):
            self.jobs.create(self.job_values)

    def test_branch_admin_cannot_repoint_existing_outbox(self):
        job = self.jobs.sudo().create(self.job_values)
        with self.assertRaises(AccessError):
            job.with_user(self.operator).write({"printer_id": "another-foreign-printer"})

    def test_branch_admin_cannot_inject_an_automation_source(self):
        # Refusal must occur before the ORM resolves an attacker-selected
        # policy/source reference; no real source document is needed.
        with self.assertRaises(AccessError):
            self.intents.create({
                "company_id": self.branch.id, "policy_id": 999999,
                "res_model": "account.move", "res_id": 999999,
                "event_type": "invoice_posted", "intent_key": "forged-source",
            })

    def test_existing_operator_bookkeeping_remains_writable(self):
        job = self.jobs.sudo().create(self.job_values)
        job.with_user(self.operator).write({"last_error": "operator recovery"})
        self.assertEqual(job.last_error, "operator recovery")


@tagged("post_install", "-at_install")
class TestStatusInstallationIsolation(TransactionCase):
    """Real ORM/SQL polling with an isolated HTTP response boundary."""

    def test_batch_status_authenticates_each_saved_installation_separately(self):
        installation_a = "00000000-0000-4000-8000-000000000001"
        installation_b = "00000000-0000-4000-8000-000000000002"
        proofs = {installation_a: "a" * 43, installation_b: "b" * 43}
        config = self.env["print_gateway.gateway_config"].create({
            "company_id": self.env.company.id,
            "gateway_url": "https://gateway.example.com",
            "gateway_api_key": "status-test-credential",
        })
        jobs = self.env["print_gateway.print_job"].create([{
            "company_id": self.env.company.id, "gateway_config_id": config.id,
            "printer_id": "status-test-printer", "destination": "Status test",
            "document_type": "invoice", "status": "submitted",
            "gateway_job_id": "status-installation-%s" % index,
            "idempotency_key": "status-installation-%s" % index,
            "gateway_idempotency_version": 2 if installation else 1,
            "gateway_installation_id": installation,
            "payload": json.dumps({"type": "pdf", "encoding": "base64", "data": "JVBERi0xLjQKJSVFT0Y="}),
        } for index, installation in enumerate((installation_a, installation_a, installation_b, False))])
        jobs.flush_recordset()
        batches = []

        def status_response(_url, **request):
            batches.append(request)
            return Mock(status_code=200, json=lambda: {"jobs": [
                {"jobId": job_id, "status": "submitted"}
                for job_id in request["json"]["jobIds"]
            ]})

        with tempfile.TemporaryDirectory() as proof_dir, patch.dict(os.environ, {
            "YASEIR_ODOO_INSTALLATION_PROOFS": json.dumps(proofs),
        }), patch(
            "odoo.addons.print_gateway.models.print_job.deployment_proof",
            side_effect=lambda installation, database, origin, company_id=None:
                deployment_proof(installation, database, origin, proof_dir, company_id),
        ), patch.object(type(self.env["ir.cron"]), "_commit_progress", return_value=30), patch(
            "odoo.addons.print_gateway.models.print_job.requests.post", side_effect=status_response,
        ):
            self.assertEqual(jobs.cron_sync_status(), 4)

        self.assertEqual(len(batches), 3)
        expected = [(["status-installation-0", "status-installation-1"], installation_a),
                    (["status-installation-2"], installation_b),
                    (["status-installation-3"], False)]
        for batch, (job_ids, installation) in zip(batches, expected):
            self.assertEqual(batch["json"]["jobIds"], job_ids)
            headers = batch["headers"]
            if installation:
                self.assertEqual(headers["X-Yaseir-Odoo-Installation"], installation)
                self.assertEqual(headers["X-Yaseir-Odoo-Proof"], proofs[installation])
                self.assertEqual(headers["X-Yaseir-Odoo-Idempotency-Version"], "2")
            else:
                self.assertNotIn("X-Yaseir-Odoo-Installation", headers)
