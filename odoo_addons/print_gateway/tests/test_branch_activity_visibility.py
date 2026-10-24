# -*- coding: utf-8 -*-
"""Branch print-activity visibility (ODO-05 / ODO-07).

A print job and a print intent are owned by the company of the record that
produced them. For a Branch-owned print that is the Branch company, so the
recovery path documented to operators ("check Print Activity before
retrying") and to automation operators ("manual operator re-arm required")
must be able to list those rows from a root-Company session. These tests pin
that the record rules scope rows to the activated company and its direct
children, and that they never expose another Company's rows.
"""
import json
from unittest.mock import patch

from odoo.tests import tagged
from odoo.tests.common import TransactionCase
from odoo.addons.print_gateway.models.gateway_config import PrintGatewayConfig


@tagged("post_install", "-at_install")
class TestPrintGatewayBranchActivityVisibility(TransactionCase):

    def setUp(self):
        super().setUp()
        self.root = self.env.company
        self.branch = self.env["res.company"].create({
            "name": "Activity Visibility Branch",
            "parent_id": self.root.id,
        })
        self.other_root = self.env["res.company"].create({
            "name": "Activity Visibility Other Root",
        })
        self.other_branch = self.env["res.company"].create({
            "name": "Activity Visibility Other Branch",
            "parent_id": self.other_root.id,
        })
        self.env = self.env(context=dict(self.env.context, allowed_company_ids=[
            self.root.id, self.branch.id,
        ]))
        with patch.object(PrintGatewayConfig, "_validate_gateway_host", return_value=None):
            self.gateway_config = self.env["print_gateway.gateway_config"].search(
                [("company_id", "=", self.root.id)], limit=1)
            if not self.gateway_config:
                self.gateway_config = self.env["print_gateway.gateway_config"].create({
                    "company_id": self.root.id,
                    "gateway_url": "https://gateway.example.com",
                    "enabled": True,
                    "gateway_api_key": "test_api_key_activity_visibility",
                })

    def _create_job(self, company, key):
        return self.env["print_gateway.print_job"].create({
            "company_id": company.id,
            "gateway_config_id": self.gateway_config.id,
            "printer_id": "printer-activity-visibility",
            "destination": "Activity Destination",
            "document_type": "invoice",
            "status": "queued",
            "payload": json.dumps({"type": "escpos", "protocol": "escpos", "encoding": "base64", "data": "dGVzdA=="}),
            "idempotency_key": key,
        })

    def _root_operator(self):
        return self.env["res.users"].create({
            "name": "Root Activity Operator",
            "login": "root_activity_operator_%s" % self.root.id,
            "company_id": self.root.id,
            "company_ids": [(6, 0, [self.root.id])],
        })

    def _branch_operator(self):
        return self.env["res.users"].create({
            "name": "Branch Activity Operator",
            "login": "branch_activity_operator_%s" % self.branch.id,
            "company_id": self.branch.id,
            "company_ids": [(6, 0, [self.branch.id])],
        })

    def _visible_job_ids(self, user, allowed_company_ids):
        env = self.env(context=dict(self.env.context, allowed_company_ids=allowed_company_ids))
        operator = env["res.users"].browse(user.id)
        return set(env["print_gateway.print_job"].with_user(operator).search([]).ids)

    def test_root_operator_sees_branch_print_activity(self):
        """A root-Company operator must see the Branch print activity.

        Otherwise the documented recovery path silently shows an empty list
        for exactly the failed Branch print that needs reconciliation.
        """
        branch_job = self._create_job(self.branch, "activity_branch_job_01")
        operator = self._root_operator()
        self.assertIn(branch_job.id, self._visible_job_ids(operator, [self.root.id]))

    def test_branch_operator_sees_own_branch_print_activity(self):
        branch_job = self._create_job(self.branch, "activity_branch_job_02")
        operator = self._branch_operator()
        self.assertIn(branch_job.id, self._visible_job_ids(operator, [self.branch.id]))

    def test_branch_operator_does_not_see_root_print_activity(self):
        """Branch scope must not widen upward to the root Company's jobs."""
        root_job = self._create_job(self.root, "activity_root_job_01")
        operator = self._branch_operator()
        self.assertNotIn(root_job.id, self._visible_job_ids(operator, [self.branch.id]))

    def test_root_operator_does_not_see_another_companys_print_activity(self):
        """The child-company clause must never cross into another Company."""
        foreign_job = self._create_job(self.other_branch, "activity_foreign_job_01")
        operator = self._root_operator()
        self.assertNotIn(foreign_job.id, self._visible_job_ids(operator, [self.root.id]))

    def test_branch_intent_is_visible_to_the_root_operator(self):
        """A permanently failed Branch intent must be findable and re-armable."""
        model = self.env["ir.model"].search([("model", "=", "pos.order")], limit=1)
        policy = self.env["print_gateway.policy"].create({
            "company_id": self.root.id,
            "branch_id": self.branch.id,
            "name": "Activity Visibility Policy",
            "model_id": model.id,
            "event_type": "pos_order_paid",
            "action_type": "raw_template",
            "raw_template": "^XA^FD{name}^FS^XZ",
            "raw_protocol": "zpl",
            "binding_id": False,
            "active": True,
        })
        intent = self.env["print_gateway.intent"].create({
            "company_id": self.branch.id,
            "policy_id": policy.id,
            "res_model": "pos.order",
            "res_id": 1,
            "event_type": "pos_order_paid",
            "intent_key": "activity_branch_intent_01",
            "status": "failed",
            "attempts": 5,
        })
        operator = self._root_operator()
        env = self.env(context=dict(self.env.context, allowed_company_ids=[self.root.id]))
        visible = env["print_gateway.intent"].with_user(env["res.users"].browse(operator.id)).search([])
        self.assertIn(intent.id, visible.ids)
