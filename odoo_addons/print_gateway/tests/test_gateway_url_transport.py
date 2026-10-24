
# Hard imports: this module only runs under the Odoo test runner; a fallback
# previously degraded the whole file into silent skips with a green exit.
from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase
from odoo.tests import tagged
from odoo.addons.print_gateway.models.gateway_config import PrintGatewayConfig, _friendly_gateway_request_error
import requests
import json
import logging
import os
import secrets
import threading
import time
import uuid
from unittest.mock import patch

from odoo import api
from odoo.addons.print_gateway.idempotency_namespace import _identity_path


_logger = logging.getLogger(__name__)


@tagged("post_install", "-at_install")
class TestPrintGatewayURLTransport(TransactionCase):
    def _config(self, url):
        return self.env['print_gateway.gateway_config'].create({
            'company_id': self.env.company.id,
            'gateway_url': url,
            'gateway_api_key': 'test-key',
        })

    def test_https_gateway_url_is_accepted(self):
        config = self._config('https://gateway.example.com')
        self.assertEqual(config.gateway_url, 'https://gateway.example.com')

    def test_equivalent_gateway_url_preserves_existing_installation(self):
        # Use a historical noncanonical spelling: normalizing existing rows
        # on upgrade would orphan its external proof file just as an edit did.
        original_url = 'https://GATEWAY.EXAMPLE.COM:443'
        config = self._config(original_url)
        installation = config._ensure_auto_installation()
        revision = config.enabled_sync_revision
        for equivalent_url in (
            'https://gateway.example.com',
            'https://gateway.example.com/',
            'https://gateway.example.com:443',
            'https://gateway.example.com.',
        ):
            with self.subTest(url=equivalent_url):
                config.write({'gateway_url': equivalent_url})
                self.assertEqual(config.gateway_url, original_url)
                self.assertEqual(config.installation_id, installation)
                self.assertTrue(config.idempotency_v2_enabled)
                self.assertEqual(config._ensure_auto_installation(), installation)
                self.assertEqual(config.enabled_sync_revision, revision)
                self.assertFalse(config.pending_disable_gateway_url)

    def test_multi_company_url_edit_preserves_each_existing_origin_spelling(self):
        config = self._config('https://gateway.example.com')
        other_company = self.env['res.company'].create({'name': 'Origin identity test'})
        other = self.env['print_gateway.gateway_config'].create({
            'company_id': other_company.id,
            'gateway_url': 'https://GATEWAY.EXAMPLE.COM:443',
            'gateway_api_key': 'test-key-other-company',
        })
        installations = {row.id: row._ensure_auto_installation() for row in config | other}
        (config | other).write({'gateway_url': 'https://gateway.example.com/'})
        self.assertEqual(config.gateway_url, 'https://gateway.example.com')
        self.assertEqual(other.gateway_url, 'https://GATEWAY.EXAMPLE.COM:443')
        for row in config | other:
            self.assertEqual(row._ensure_auto_installation(), installations[row.id])
            self.assertFalse(row.pending_disable_gateway_url)

    def test_http_gateway_url_is_rejected_by_default(self):
        with self.assertRaises(ValidationError):
            PrintGatewayConfig._validate_gateway_url("http://gateway.example.com")

    def test_http_gateway_url_is_rejected_on_production_main(self):
        for url in (
            "http://gateway.example.com",
            "http://192.168.1.50:3000",
            "http://10.0.0.5:3000",
        ):
            with self.subTest(url=url):
                with self.assertRaises(ValidationError):
                    PrintGatewayConfig._validate_gateway_url(url)

    def test_unsupported_gateway_url_scheme_is_rejected(self):
        with self.assertRaises(ValidationError):
            self._config('ftp://gateway.example.com')

    def test_gateway_url_without_host_is_rejected(self):
        with self.assertRaises(ValidationError):
            self._config('http://')

    def test_gateway_url_rejects_embedded_credentials_and_api_paths(self):
        with self.assertRaises(ValidationError):
            self._config('https://user:pass@gateway.example.com')
        with self.assertRaises(ValidationError):
            self._config('https://gateway.example.com/api')

    def test_friendly_gateway_request_error_formats_requests_exceptions(self):
        url = "https://gateway.example.com"
        connection = _friendly_gateway_request_error(
            requests.exceptions.ConnectionError("Connection refused"),
            url,
        )
        timeout = _friendly_gateway_request_error(
            requests.exceptions.Timeout("Read timeout"),
            url,
        )
        generic = _friendly_gateway_request_error(
            requests.exceptions.RequestException("unexpected transport failure"),
            url,
        )
        self.assertIn(url, connection)
        self.assertIn(url, timeout)
        self.assertIn(url, generic)
        self.assertIn("unexpected transport failure", generic)

    def test_gateway_redirect_message_redacts_sensitive_location(self):
        from odoo.addons.print_gateway.models.gateway_config import _gateway_redirect_message
        response = type("Response", (), {
            "status_code": 307,
            "headers": {
                "Location": "https://user:pass@gateway.example.com/login?token=SUPER_SECRET&sig=PRIVATE#fragment"
            },
        })()
        message = _gateway_redirect_message(response, "https://gateway.example.com")
        self.assertIn("gateway.example.com", message)
        self.assertNotIn("SUPER_SECRET", message)
        self.assertNotIn("PRIVATE", message)
        self.assertNotIn("user:pass", message)
        self.assertNotIn("/login", message)

@tagged("post_install", "-at_install")
class TestConnectionEnrollmentTransaction(TransactionCase):
    def _connection_enrollment_transaction(self, *, legacy_credential=False, rollback=False,
                                          health_status=200, pending=False, pending_only=False,
                                          superseded=False):
        """Exercise the real action and independent cursors, with only HTTP controlled.

        A committed fixture is essential: an uncommitted TransactionCase row is
        invisible to the independent result writer and conceals the self-block.
        The local lock timeout bounds a regression; it is not a product setting.
        """
        registry = self.env.registry
        original_cursor = registry.cursor
        origin = "https://127.0.0.1:49201"
        previous_origin = "https://127.0.0.1:49202"
        secret = secrets.token_urlsafe(32)
        previous_secret = secrets.token_urlsafe(32)
        company_id = config_id = partner_id = None
        identity_path = None
        request_cr = None
        request_pid = None
        writer_pids = []
        calls = []
        blocked = []
        observer_errors = []
        stop = threading.Event()
        observer = None

        def response(body, status=200):
            result = requests.Response()
            result.status_code = status
            result._content = json.dumps(body).encode()
            return result

        def health(url, **kwargs):
            self.assertEqual(url, origin + "/api/odoo/health")
            self.assertEqual(kwargs["timeout"], 10)
            self.assertFalse(kwargs["allow_redirects"])
            calls.append("health")
            if superseded:
                with original_cursor() as cr:
                    cr.execute("""UPDATE print_gateway_gateway_config SET enabled_sync_revision=1,
                                  last_enabled_sync_revision=1, last_test_status='success'
                                  WHERE id=%s""", [config_id])
                    cr.commit()
            return response({"ok": health_status == 200}, health_status)

        def enroll(url, **kwargs):
            self.assertEqual(url, origin + "/api/odoo/installations/auto")
            self.assertEqual(len(kwargs["json"]["installationProof"]), 43)
            calls.append("enrollment")
            return response({"installationId": kwargs["json"]["installationId"], "idempotencyVersion": 2}, 201)

        def activate(url, **kwargs):
            self.assertEqual(kwargs["json"]["revision"], 0)
            if url == previous_origin + "/api/odoo/configuration":
                self.assertEqual(kwargs["headers"]["Authorization"], "Bearer " + previous_secret)
                self.assertFalse(kwargs["json"]["enabled"])
                calls.append("old_shutdown")
            else:
                self.assertEqual(url, origin + "/api/odoo/configuration")
                self.assertEqual(kwargs["headers"]["Authorization"], "Bearer " + secret)
                calls.append("activation")
            return response({"ok": True, **kwargs["json"]})

        def bounded_cursor(*args, **kwargs):
            cr = original_cursor(*args, **kwargs)
            cr.execute("SET LOCAL lock_timeout = '1500ms'")
            cr.execute("SELECT pg_backend_pid()")
            writer_pids.append(cr.fetchone()[0])
            return cr

        def observe_locks(request_pid):
            try:
                with original_cursor() as cr:
                    cr.execute("SET LOCAL statement_timeout = '500ms'")
                    deadline = time.monotonic() + 6
                    while not stop.is_set() and time.monotonic() < deadline:
                        cr.execute("""
                            SELECT pid, wait_event_type, wait_event,
                                   pg_blocking_pids(pid), query
                            FROM pg_stat_activity
                            WHERE datname = current_database()
                              AND %s = ANY(pg_blocking_pids(pid))
                              AND query LIKE 'SELECT enabled_sync_revision%%FOR UPDATE%%'
                        """, [request_pid])
                        for pid, event_type, event, blockers, query in cr.fetchall():
                            item = {"waiting_pid": pid, "request_pid": request_pid,
                                    "wait_event_type": event_type, "wait_event": event,
                                    "blocking_pids": blockers, "waiting_query": query}
                            if item not in blocked:
                                blocked.append(item)
                        # Avoid pg_stat_activity's per-transaction snapshot cache.
                        cr.execute("SELECT pg_stat_clear_snapshot()")
                        stop.wait(0.025)
            except Exception as error:
                observer_errors.append(type(error).__name__)

        try:
            with patch.dict(os.environ, {"YASEIR_GATEWAY_ALLOWED_ORIGINS": origin + "," + previous_origin}):
                with original_cursor() as cr:
                    setup = api.Environment(cr, api.SUPERUSER_ID, {})
                    company = setup["res.company"].create({"name": "Enrollment transaction " + uuid.uuid4().hex})
                    company_id, partner_id = company.id, company.partner_id.id
                    # Only fixture creation suppresses its automatic callback.
                    # The action under test uses all real enrollment/sync code.
                    with patch.object(PrintGatewayConfig, "_queue_enabled_state_sync"):
                        config = setup["print_gateway.gateway_config"].create({
                            "company_id": company_id, "gateway_url": origin,
                            "gateway_api_key": secret, "enabled": True,
                        })
                    config_id = config.id
                    identity_path = _identity_path(cr.dbname, origin, company_id=company_id)
                    if legacy_credential:
                        config._ensure_auto_installation()
                        config.flush_recordset()
                        cr.execute("UPDATE print_gateway_gateway_config SET gateway_api_key=%s WHERE id=%s", [secret, config_id])
                    if pending:
                        config.flush_recordset()
                        cr.execute("""UPDATE print_gateway_gateway_config
                            SET pending_disable_gateway_url=%s, pending_disable_gateway_api_key=%s,
                                pending_disable_revision=0, gateway_api_key=CASE WHEN %s THEN NULL ELSE gateway_api_key END
                            WHERE id=%s""", [previous_origin, previous_secret, pending_only, config_id])
                    cr.commit()

                request_cr = original_cursor()
                request_cr.execute("SELECT pg_backend_pid()")
                request_pid = request_cr.fetchone()[0]
                request_env = api.Environment(request_cr, api.SUPERUSER_ID, {"allowed_company_ids": [company_id]})
                config = request_env["print_gateway.gateway_config"].browse(config_id)
                observer = threading.Thread(target=observe_locks, args=(request_pid,), daemon=True)
                observer.start()
                with patch.object(registry, "cursor", side_effect=bounded_cursor), patch(
                    "odoo.addons.print_gateway.models.gateway_config.requests.get", side_effect=health,
                ), patch(
                    "odoo.addons.print_gateway.models.gateway_config.requests.post", side_effect=enroll,
                ), patch(
                    "odoo.addons.print_gateway.models.gateway_config.requests.patch", side_effect=activate,
                ):
                    action = config.action_retry_enabled_sync() if pending else config.action_test_connection()
                    calls_before_boundary = list(calls)
                    if rollback:
                        request_cr.rollback()
                    else:
                        request_cr.commit()
                stop.set()
                observer.join(3)
                _logger.info("ENROLLMENT_TRANSACTION_PROOF %s", json.dumps({
                    "legacy_credential": legacy_credential, "rollback": rollback,
                    "health_status": health_status, "pending": pending, "pending_only": pending_only,
                    "superseded": superseded,
                    "request_pid": request_pid, "blocked": blocked,
                    "writer_pids": writer_pids,
                    "calls_before_transaction_boundary": calls_before_boundary,
                    "calls_after_transaction_boundary": calls,
                    "observer_errors": observer_errors,
                }, sort_keys=True))
                self.assertFalse(observer.is_alive())
                self.assertEqual(observer_errors, [])
                self.assertNotIn(request_pid, writer_pids, "Result persistence must use a distinct PostgreSQL backend")
                if not rollback:
                    self.assertTrue(writer_pids)
                self.assertEqual(blocked, [], "Connection Test must not block a fresh result cursor on its own row write")
                self.assertEqual(action, {"type": "ir.actions.client", "tag": "reload"})
                expected_before = [] if pending else (["health", "enrollment"] if health_status == 200 else ["health"])
                self.assertEqual(calls_before_boundary, expected_before, "Activation must wait for the request transaction to commit")
                with original_cursor() as cr:
                    final = api.Environment(cr, api.SUPERUSER_ID, {})["print_gateway.gateway_config"].browse(config_id)
                    if rollback:
                        self.assertEqual(calls, expected_before)
                        self.assertFalse(final.last_test_at)
                        self.assertFalse(final.last_test_error)
                        self.assertTrue(final.enabled)
                        if not legacy_credential:
                            self.assertFalse(final.installation_id)
                        if pending:
                            self.assertEqual(final.pending_disable_gateway_url, previous_origin)
                    elif superseded:
                        self.assertEqual(calls, ["health"])
                        self.assertEqual(final.enabled_sync_revision, 1)
                        self.assertEqual(final.last_enabled_sync_revision, 1)
                        self.assertEqual(final.last_test_status, "success")
                        self.assertTrue(final.enabled)
                    elif health_status != 200:
                        self.assertEqual(calls, ["health"])
                        self.assertEqual(final.last_test_status, "revoked" if health_status == 401 else "failed")
                        self.assertTrue(final.last_test_error)
                        if health_status == 401:
                            self.assertFalse(final.enabled)
                    else:
                        expected_after = (["old_shutdown"] if pending_only else ["old_shutdown", "activation"]) if pending else ["health", "enrollment", "activation"]
                        self.assertEqual(calls, expected_after)
                        if not pending:
                            self.assertTrue(final.installation_id)
                            self.assertTrue(final.idempotency_v2_enabled)
                        else:
                            self.assertFalse(final.pending_disable_gateway_url)
                            self.assertFalse(final.pending_disable_gateway_api_key)
                        self.assertEqual(final.last_test_status, "success")
                        self.assertEqual(final.enabled_sync_revision, final.last_enabled_sync_revision)
                        self.assertFalse(final.last_enabled_sync_error)
                        self.assertNotEqual(final.gateway_api_key, secret)
                        if pending_only:
                            self.assertFalse(final.gateway_api_key)
        finally:
            stop.set()
            if observer is not None:
                observer.join(3)
            if request_cr is not None:
                request_cr.rollback()
                request_cr.close()
            if company_id:
                with original_cursor() as cr:
                    cr.execute("DELETE FROM print_gateway_gateway_config WHERE id=%s", [config_id])
                    cleanup = api.Environment(cr, api.SUPERUSER_ID, {})
                    # Stock's test-only company hook creates an otherwise unused
                    # warehouse. Remove only this fixture company's dependants.
                    cleanup["stock.rule"].with_context(active_test=False).search([("company_id", "=", company_id)]).unlink()
                    cleanup["stock.warehouse"].with_context(active_test=False).search([("company_id", "=", company_id)]).unlink()
                    cleanup["stock.picking.type"].with_context(active_test=False).search([("company_id", "=", company_id)]).unlink()
                    cleanup["stock.route"].with_context(active_test=False).search([("company_id", "=", company_id)]).unlink()
                    cleanup["ir.default"].search([("company_id", "=", company_id)]).unlink()
                    cleanup["res.company"].browse(company_id).write({"internal_transit_location_id": False})
                    cleanup["stock.location"].with_context(active_test=False).search([("company_id", "=", company_id)]).unlink()
                    cleanup["res.company"].browse(company_id).exists().unlink()
                    cleanup["res.partner"].browse(partner_id).exists().unlink()
                    cr.commit()
            if identity_path is not None:
                identity_path.unlink(missing_ok=True)

    def test_first_connection_enrollment_activates_only_after_commit(self):
        self._connection_enrollment_transaction()

    def test_legacy_credential_connection_activates_only_after_commit(self):
        self._connection_enrollment_transaction(legacy_credential=True)

    def test_rolled_back_connection_enrollment_does_not_activate(self):
        self._connection_enrollment_transaction(rollback=True)

    def test_legacy_credential_health_failure_persists_after_commit(self):
        for status in (401, 500):
            with self.subTest(status=status):
                self._connection_enrollment_transaction(legacy_credential=True, health_status=status)

    def test_retry_pending_legacy_credential_waits_for_commit(self):
        self._connection_enrollment_transaction(pending=True)

    def test_retry_pending_only_shutdown_keeps_old_credential(self):
        self._connection_enrollment_transaction(pending=True, pending_only=True)

    def test_rolled_back_pending_retry_does_not_send_shutdown(self):
        self._connection_enrollment_transaction(pending=True, rollback=True)

    def test_stale_health_result_preserves_newer_revision(self):
        self._connection_enrollment_transaction(health_status=401, superseded=True)

    def test_rolled_back_legacy_health_failure_does_not_persist(self):
        self._connection_enrollment_transaction(legacy_credential=True, health_status=401, rollback=True)
