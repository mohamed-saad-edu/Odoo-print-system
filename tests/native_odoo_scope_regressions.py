"""Focused native Odoo 19 regression gate; requires an isolated installed database.

Run with Odoo's Python/source on PYTHONPATH, followed by ordinary Odoo config
arguments. Uses real ORM and independent committed cursors; forbids HTTP. Fixture
rows are intentionally confined to the disposable local test database.
"""
import base64
import json
import sys
import unittest
import uuid
from unittest.mock import patch

from odoo import api
from odoo.exceptions import ValidationError
from odoo.modules.registry import Registry
from odoo.tools import config


class NativeScopeRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.network = patch('requests.sessions.Session.request', side_effect=AssertionError('Network forbidden'))
        cls.network.start()
        cls.addClassCleanup(cls.network.stop)
        cls.registry = Registry(config['db_name'][0])
        with cls.registry.cursor() as cr:
            env = api.Environment(cr, 1, {})
            suffix = uuid.uuid4().hex
            root = env['res.company'].create({'name': 'Scope regression ' + suffix})
            branch = env['res.company'].create({'name': 'Branch ' + suffix, 'parent_id': root.id})
            sibling = env['res.company'].create({'name': 'Sibling ' + suffix, 'parent_id': root.id})
            env = env(context={'allowed_company_ids': [root.id, branch.id, sibling.id]})
            cfg = env['print_gateway.gateway_config'].create({
                'company_id': root.id, 'gateway_url': 'https://gateway.example.com', 'enabled': True,
            })
            assignment = env['print_gateway.runtime_agent_assignment'].create({
                'company_id': root.id, 'runtime_agent_id': suffix,
            })
            report = env.ref('account.account_invoices')
            binding = env['print_gateway.binding'].create({
                'company_id': root.id, 'destination_type': 'report', 'report_id': report.id,
                'runtime_agent_id': suffix, 'printer_id': suffix, 'printer_protocol': 'spooler',
            })
            cls.ids = (root.id, branch.id, sibling.id, cfg.id, binding.id, assignment.id)
            cr.commit()

    def setUp(self):
        self.cr = self.registry.cursor()
        self.addCleanup(self.cr.close)
        root, branch, sibling, cfg, binding, assignment = self.ids
        self.env = api.Environment(self.cr, 1, {'allowed_company_ids': [root, branch, sibling]})
        self.root, self.branch, self.sibling = [self.env['res.company'].browse(i) for i in (root, branch, sibling)]
        self.cfg = self.env['print_gateway.gateway_config'].browse(cfg)
        self.binding = self.env['print_gateway.binding'].browse(binding)
        self.assignment = self.env['print_gateway.runtime_agent_assignment'].browse(assignment)
        self.report = self.env.ref('account.account_invoices')
        self.router = self.env['print_gateway.print_router']

    def test_explicit_company_wide_binding(self):
        route = self.router.resolve_binding(report=self.report, company=self.root,
                                            explicit_binding=self.binding, payload_type='pdf')
        self.assertEqual(route['binding'], self.binding)

    def test_company_wide_fallback_persists_for_branch(self):
        router = self.router.with_company(self.branch)
        route = router.resolve_binding(report=self.report, company=self.branch, payload_type='pdf')
        self.assertEqual(route['binding'], self.binding)
        job_id = router._persist_durable_job({
            'company': self.branch, 'gateway_config': self.cfg, 'printer_id': self.binding.printer_id,
            'destination': self.report.display_name, 'destination_key': f'ir.actions.report,{self.report.id}',
            'document_type': 'invoice', 'report': self.report, 'binding': self.binding,
            'payload': {'type': 'pdf', 'encoding': 'base64',
                        'data': base64.b64encode(b'%PDF-1.4\n%%EOF').decode()},
            'idempotency_key': uuid.uuid4().hex,
        })
        with self.registry.cursor() as verify_cr:
            job = api.Environment(verify_cr, 1, {})['print_gateway.print_job'].browse(job_id)
            self.assertEqual(job.company_id.id, self.branch.id)
            self.assertEqual(job.printer_id, self.binding.printer_id)
            self.assertEqual(job.status, 'queued')

    def test_explicit_sibling_binding_is_denied(self):
        self.env['print_gateway.runtime_agent_assignment'].create({
            'company_id': self.root.id, 'branch_id': self.sibling.id,
            'runtime_agent_id': self.binding.runtime_agent_id,
        })
        sibling_binding = self.binding.copy({'branch_id': self.sibling.id,
                                             'runtime_agent_id': self.binding.runtime_agent_id,
                                             'printer_id': self.binding.printer_id})
        with self.assertRaises(ValidationError):
            self.router.with_company(self.branch).resolve_binding(
                report=self.report, company=self.branch, explicit_binding=sibling_binding, payload_type='pdf')

    def test_binding_moved_to_sibling_after_resolution_is_denied(self):
        self._assert_moved_binding_denied(move_company=False)

    def test_binding_moved_to_other_company_after_resolution_is_denied(self):
        self._assert_moved_binding_denied(move_company=True)

    def _assert_moved_binding_denied(self, *, move_company):
        # Resolve a committed binding, then mutate through a separate cursor
        # exactly as another administrator can between routing and persistence.
        with self.registry.cursor() as setup_cr:
            env = api.Environment(setup_cr, 1, {})
            original = env['print_gateway.binding'].browse(self.binding.id)
            agent = uuid.uuid4().hex
            env['print_gateway.runtime_agent_assignment'].create({
                'company_id': self.root.id, 'branch_id': self.branch.id, 'runtime_agent_id': agent})
            binding = original.copy({'printer_id': 'scope-race-' + uuid.uuid4().hex,
                                      'runtime_agent_id': agent, 'branch_id': self.branch.id})
            binding_id = binding.id
            setup_cr.commit()
        self.cr.rollback()  # refresh the repeatable-read snapshot after fixture commit
        selected = self.env['print_gateway.binding'].browse(binding_id)
        router = self.router.with_company(self.branch)
        router.resolve_binding(report=self.report, company=self.branch,
                               explicit_binding=selected, payload_type='pdf')
        printer_id = selected.printer_id
        with self.registry.cursor() as mutate_cr:
            env = api.Environment(mutate_cr, 1, {})
            binding = env['print_gateway.binding'].browse(binding_id)
            if move_company:
                other = env['res.company'].create({'name': 'Other scope ' + uuid.uuid4().hex})
                env['print_gateway.runtime_agent_assignment'].create({
                    'company_id': other.id, 'runtime_agent_id': binding.runtime_agent_id})
                binding.write({'company_id': other.id, 'branch_id': False})
            else:
                env['print_gateway.runtime_agent_assignment'].create({
                    'company_id': self.root.id, 'branch_id': self.sibling.id,
                    'runtime_agent_id': binding.runtime_agent_id})
                binding.branch_id = self.sibling.id
            mutate_cr.commit()
        with self.assertRaises(ValidationError):
            router._persist_durable_job({
                'company': self.branch, 'gateway_config': self.cfg, 'printer_id': printer_id,
                'destination': self.report.display_name, 'destination_key': f'ir.actions.report,{self.report.id}',
                'document_type': 'invoice', 'report': self.report, 'binding': selected,
                'payload': {'type': 'pdf', 'encoding': 'base64',
                            'data': base64.b64encode(b'%PDF-1.4\n%%EOF').decode()},
                'idempotency_key': uuid.uuid4().hex,
            })

    def test_unassigned_company_wide_binding_is_denied(self):
        self.assignment.enabled = False
        with self.assertRaises(ValidationError):
            self.router.with_company(self.branch).resolve_binding(
                report=self.report, company=self.branch, explicit_binding=self.binding, payload_type='pdf')

    def test_unbound_sale_details_keeps_native_report(self):
        result = self.router.route_render_target(
            'point_of_sale.sale_details_report', self.env['report.point_of_sale.report_saledetails'],
            company=self.root, document_type='report:point_of_sale.sale_details_report')
        self.assertTrue(result['native'])

    def _failed_job(self, remote_id=False):
        return self.env['print_gateway.print_job'].create({
            'company_id': self.root.id, 'gateway_config_id': self.cfg.id,
            'printer_id': 'outcome-fixture', 'destination': 'Outcome fixture',
            'document_type': 'invoice', 'idempotency_key': uuid.uuid4().hex,
            'status': 'failed', 'gateway_job_id': remote_id,
            'last_error': 'Device failure after admission' if remote_id else 'GATEWAY_REJECTED_422: invalid job',
            'payload': json.dumps({'type': 'pdf', 'encoding': 'base64',
                                   'data': base64.b64encode(b'%PDF-1.4\n%%EOF').decode()}),
        })

    def test_failed_remote_job_cannot_offer_safe_retry(self):
        job = self._failed_job('accepted-remote-job')
        self.assertEqual(job.physical_outcome, 'unknown')
        result = self.router._durable_submission_outcome(job)
        self.assertEqual(result['status'], 'unknown')
        self.assertFalse(result['can_retry'])

    def test_pre_admission_refusal_can_offer_retry(self):
        job = self._failed_job()
        self.assertEqual(job.physical_outcome, 'not_printed')
        result = self.router._durable_submission_outcome(job)
        self.assertEqual(result['status'], 'failed')
        self.assertTrue(result['can_retry'])


if __name__ == '__main__':
    config.parse_config(sys.argv[1:])
    unittest.main(argv=[sys.argv[0]], verbosity=2)
