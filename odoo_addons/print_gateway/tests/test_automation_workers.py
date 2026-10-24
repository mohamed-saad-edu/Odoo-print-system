"""Real Odoo/PostgreSQL scheduler/lease tests; no printer or external HTTP."""
import base64
import datetime
import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from unittest.mock import patch

from odoo import api
from odoo.tests import tagged
from odoo.tests.common import TransactionCase

from ..runtime_clock import db_now_utc


@tagged('post_install', '-at_install')
class TestAutomationJobWorkers(TransactionCase):
    @contextmanager
    def _jobs(self, count=3):
        """Committed, independently owned fixtures; remove executable rows."""
        setup = self.env.registry.cursor()
        config_id = None
        company_id = None
        ids = []
        try:
            env = api.Environment(setup, self.env.uid, dict(self.env.context), su=True)
            company = env['res.company'].create({'name': 'Automation fixture ' + uuid.uuid4().hex})
            company_id = company.id
            config_model = env['print_gateway.gateway_config']
            with patch.object(type(config_model), '_queue_enabled_state_sync', return_value=None):
                config = config_model.create({'company_id': company.id,
                    'gateway_url': 'https://automation.invalid', 'enabled': False})
            config_id = config.id
            setup.execute('UPDATE print_gateway_gateway_config SET enabled=true WHERE id=%s', (config.id,))
            values = [{'company_id': company.id, 'gateway_config_id': config.id,
                'printer_id': 'automation-fixture-printer', 'destination': 'Automation fixture only',
                'document_type': 'receipt', 'payload': json.dumps({'type': 'raw', 'protocol': 'raw',
                    'data': base64.b64encode(b'Never dispatched to a printer\n').decode()}),
                'idempotency_key': 'automation-worker-' + uuid.uuid4().hex,
                'status': 'queued'} for _ in range(count)]
            ids = env['print_gateway.print_job'].create(values).ids
            setup.commit()
        finally:
            setup.close()
        try:
            yield ids
        finally:
            cleanup = self.env.registry.cursor()
            try:
                # The fixtures have no source audits or intents. Never delete
                # any row outside this test's explicit ID set.
                if ids:
                    cleanup.execute('DELETE FROM print_gateway_print_job WHERE id=ANY(%s)', (ids,))
                if config_id:
                    cleanup.execute('DELETE FROM print_gateway_gateway_config WHERE id=%s', (config_id,))
                if company_id:
                    cleanup.execute('UPDATE res_company SET active=false WHERE id=%s', (company_id,))
                cleanup.commit()
            finally:
                cleanup.close()

    @contextmanager
    def _intent(self):
        cr = self.env.registry.cursor()
        intent_id = policy_id = None
        try:
            env = api.Environment(cr, self.env.uid, dict(self.env.context))
            model = env['ir.model'].search([('model', '=', 'stock.picking')], limit=1)
            policy = env['print_gateway.policy'].sudo().create({
                'name': 'Automation claim fixture ' + uuid.uuid4().hex,
                'company_id': env.company.id, 'model_id': model.id,
                'event_type': 'picking_validated', 'action_type': 'raw_template',
                'raw_protocol': 'zpl', 'raw_template': '^XA^FD{id}^FS^XZ'})
            policy_id = policy.id
            intent = env['print_gateway.intent'].sudo().create({
                'company_id': env.company.id, 'intent_key': 'automation-intent-' + uuid.uuid4().hex,
                'policy_id': policy.id, 'res_model': 'stock.picking', 'res_id': 0,
                'event_type': 'picking_validated', 'status': 'pending'})
            intent_id = intent.id
            cr.commit()
        finally:
            cr.close()
        try:
            yield intent_id
        finally:
            cr = self.env.registry.cursor()
            try:
                cr.execute('DELETE FROM print_gateway_intent WHERE id=%s', (intent_id,))
                cr.execute('DELETE FROM print_gateway_policy WHERE id=%s', (policy_id,))
                cr.commit()
            finally:
                cr.close()

    def test_submission_sql_failure_rolls_back_one_item_and_continues(self):
        with self._jobs() as ids:
            cr = self.env.registry.cursor()
            try:
                env = api.Environment(cr, self.env.uid, dict(self.env.context))
                visited = []
                def submit(job, raise_on_failure=False):
                    if job.id not in ids:
                        return
                    visited.append(job.id)
                    if job.id == ids[0]:
                        job.env.cr.execute('SELECT 1 / 0', log_exceptions=False)
                    job.write({'last_error': 'AUTOMATION_FIXTURE_VISITED'})
                with patch.object(type(env['print_gateway.print_job']), 'action_submit', submit):
                    env['print_gateway.print_job'].cron_submit_pending()
                self.assertEqual(visited, ids)
                cr.execute('SELECT id,last_error FROM print_gateway_print_job WHERE id=ANY(%s) ORDER BY id', (ids,))
                rows = cr.fetchall()
                self.assertFalse(rows[0][1])
                self.assertEqual([row[1] for row in rows[1:]], ['AUTOMATION_FIXTURE_VISITED'] * 2)
                cr.execute('SELECT 1')
                self.assertEqual(cr.fetchone(), (1,))
            finally:
                cr.rollback()
                cr.close()

    def test_locked_oldest_batch_does_not_starve_unlocked_work(self):
        with self._jobs(27) as ids:
            blocker = self.env.registry.cursor()
            cr = self.env.registry.cursor()
            try:
                blocker.execute('SELECT id FROM print_gateway_print_job WHERE id=ANY(%s) FOR UPDATE', (ids[:25],))
                env = api.Environment(cr, self.env.uid, dict(self.env.context))
                visited = []
                def submit(job, raise_on_failure=False):
                    if job.id not in ids:
                        return
                    visited.append(job.id)
                    # This is the point a real worker would perform HTTP. A
                    # fresh transaction must be able to acquire this row now.
                    probe = self.env.registry.cursor()
                    try:
                        probe.execute('SELECT id FROM print_gateway_print_job WHERE id=%s FOR UPDATE NOWAIT', (job.id,))
                        self.assertEqual(probe.fetchone(), (job.id,))
                    finally:
                        probe.rollback()
                        probe.close()
                with patch.object(type(env['print_gateway.print_job']), 'action_submit', submit):
                    env['print_gateway.print_job'].cron_submit_pending()
                self.assertEqual(visited, ids[25:])
            finally:
                cr.rollback()
                cr.close()
                blocker.rollback()
                blocker.close()

    def test_duplicate_concurrent_intent_claims_have_one_owner(self):
        with self._intent() as intent_id:
            model = type(self.env['print_gateway.intent'])
            barrier = threading.Barrier(2)
            def claim():
                barrier.wait(timeout=10)
                return model._claim_intent(self.env, intent_id)
            with ThreadPoolExecutor(max_workers=2) as workers:
                results = list(workers.map(lambda _: claim(), range(2)))
            owners = [value for value in results if value]
            self.assertEqual(len(owners), 1)
            cr = self.env.registry.cursor()
            try:
                cr.execute('SELECT status,attempts,claim_token FROM print_gateway_intent WHERE id=%s', (intent_id,))
                self.assertEqual(cr.fetchone(), ('claimed', 1, owners[0]))
            finally:
                cr.close()

    def test_stale_intent_lease_recovery_refuses_old_worker_finalization(self):
        with self._intent() as intent_id:
            model = type(self.env['print_gateway.intent'])
            first = model._claim_intent(self.env, intent_id)
            self.assertTrue(first)
            cr = self.env.registry.cursor()
            try:
                cr.execute("UPDATE print_gateway_intent SET claimed_at=(NOW() AT TIME ZONE 'UTC')-INTERVAL '6 minutes' WHERE id=%s", (intent_id,))
                cr.commit()
            finally:
                cr.close()
            second = model._claim_intent(self.env, intent_id)
            self.assertTrue(second)
            self.assertNotEqual(first, second)
            self.assertFalse(model._finalize_intent_state(self.env, intent_id, first, 'skipped'))
            self.assertTrue(model._finalize_intent_state(self.env, intent_id, second, 'skipped'))
            cr = self.env.registry.cursor()
            try:
                cr.execute('SELECT status,attempts,claim_token FROM print_gateway_intent WHERE id=%s', (intent_id,))
                self.assertEqual(cr.fetchone(), ('skipped', 2, None))
            finally:
                cr.close()

    def test_unknown_outbox_is_never_resubmitted_by_cron_or_submit_action(self):
        with self._jobs(1) as ids:
            cr = self.env.registry.cursor()
            try:
                cr.execute("UPDATE print_gateway_print_job SET status='unknown',last_error='UNKNOWN_SUBMISSION_OUTCOME: fixture response loss' WHERE id=%s", (ids[0],))
                cr.commit()
                env = api.Environment(cr, self.env.uid, dict(self.env.context))
                model = env['print_gateway.print_job']
                original_submit = type(model).action_submit
                visited = []
                def submit_owned(job, raise_on_failure=False):
                    # Full-addon tests may leave unrelated committed jobs.
                    # Keep their external delivery outside this owned fixture,
                    # while exercising the actual query and unknown-row action.
                    owned = job.filtered(lambda record: record.id in ids)
                    if owned:
                        visited.extend(owned.ids)
                        return original_submit(owned, raise_on_failure=raise_on_failure)
                    return True
                with patch.object(type(model), 'action_submit', submit_owned), \
                     patch('odoo.addons.print_gateway.models.print_job.requests.post', side_effect=AssertionError('Unknown outcome must not perform a print POST')) as post:
                    model.cron_submit_pending()
                    self.assertEqual(visited, [], 'The scheduler selected an unknown operation')
                    model.browse(ids).action_submit()
                self.assertEqual(visited, ids)
                self.assertEqual(post.call_count, 0)
                cr.execute('SELECT status,attempts,gateway_job_id FROM print_gateway_print_job WHERE id=%s', (ids[0],))
                self.assertEqual(cr.fetchone(), ('unknown', 0, None))
            finally:
                cr.rollback()
                cr.close()

    def test_database_utc_clock_ignores_session_timezone(self):
        cr = self.env.registry.cursor()
        try:
            for zone in ['UTC', 'America/New_York', 'Pacific/Auckland', 'Asia/Riyadh']:
                cr.execute('SET LOCAL TIME ZONE %s', (zone,))
                observed = db_now_utc(cr)
                cr.execute("SELECT NOW() AT TIME ZONE 'UTC'")
                self.assertEqual(observed, cr.fetchone()[0])
                self.assertIsNone(observed.tzinfo)
        finally:
            cr.rollback()
            cr.close()

    def test_minute_cron_reschedules_across_dst_without_duplicate_wall_time(self):
        cr = self.env.registry.cursor()
        try:
            env = api.Environment(cr, self.env.uid, dict(self.env.context))
            cron = env.ref('print_gateway.cron_submit_pending_gateway_print_jobs')
            for start in [datetime.datetime(2026, 3, 8, 6, 59), datetime.datetime(2026, 11, 1, 5, 59)]:
                for minutes in [1, 10]:
                    with self.subTest(start=start.isoformat(), minutes=minutes):
                        with patch.object(type(cr), 'now', return_value=start):
                            cron.with_context(tz='America/New_York')._reschedule_later({
                                'id': cron.id, 'nextcall': start, 'interval_type': 'minutes', 'interval_number': minutes})
                        cr.execute('SELECT nextcall FROM ir_cron WHERE id=%s', (cron.id,))
                        self.assertEqual(cr.fetchone()[0], start + datetime.timedelta(minutes=minutes))
        finally:
            cr.rollback()
            cr.close()

    def test_installed_schedules_are_active_and_framework_claim_is_exclusive(self):
        refs = [('cron_submit_pending_gateway_print_jobs', 1), ('cron_sync_gateway_print_jobs', 1),
                ('cron_recover_pending_gateway_intents', 1), ('cron_sync_gateway_enabled_state', 1),
                ('cron_cleanup_terminal_gateway_print_jobs', 10)]
        for name, minutes in refs:
            cron = self.env.ref('print_gateway.' + name)
            self.assertTrue(cron.active)
            self.assertEqual((cron.interval_type, cron.interval_number), ('minutes', minutes))
            self.assertTrue(cron.user_id.has_group('base.group_system'))
        cron = self.env.ref('print_gateway.cron_submit_pending_gateway_print_jobs')
        first = self.env.registry.cursor()
        second = self.env.registry.cursor()
        try:
            self.assertTrue(cron._acquire_one_job(first, cron.id, include_not_ready=True))
            self.assertFalse(cron._acquire_one_job(second, cron.id, include_not_ready=True))
            first.rollback()
            second.rollback()
            self.assertTrue(cron._acquire_one_job(second, cron.id, include_not_ready=True))
        finally:
            first.rollback(); first.close()
            second.rollback(); second.close()
