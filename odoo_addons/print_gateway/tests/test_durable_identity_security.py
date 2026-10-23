"""Real ORM guards for service-created work (ODOO-2026-001).

These tests require the Odoo 19/PostgreSQL addon test runner. They do not submit
HTTP requests or print; the runtime-independent tests live under tests/.
"""
import json

from odoo.exceptions import AccessError
from odoo.tests.common import TransactionCase


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
