"""Actual Odoo model-bound receipt geometry and stale-image admission tests."""
import base64
from contextlib import contextmanager
from io import BytesIO
import secrets
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import uuid

from PIL import Image
from odoo import api
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import tagged
from odoo.tests.common import TransactionCase
from odoo.addons.print_gateway.models.gateway_config import PrintGatewayConfig


@tagged("post_install", "-at_install")
class TestReceiptGeometry(TransactionCase):
    def _geometry(self, dots=576, dpi=203):
        return {"version": 1, "source": "validated_profile", "validation": "configured",
                "observed_at": "2026-10-24T12:00:00Z", "printer_id": "geometry-printer",
                "config_fingerprint": "a" * 64, "printable_width_dots": dots,
                "dpi_x": dpi, "dpi_y": dpi, "paper_width_mm": 80, "raster_command": "gs_v_0"}

    def _route(self, geometry=None, connection="spooler"):
        printer = {"id": "geometry-printer", "connectionType": connection,
                   "protocol": "escpos" if connection == "usb" else "spooler",
                   "capabilities": {"geometry": geometry}}
        binding = SimpleNamespace(printer_id="geometry-printer", id=11,
                                  _validate_runtime_target=lambda **_kwargs: printer)
        return {"binding": binding, "native": False}

    def test_actual_router_uses_selected_203_300_and_600_dpi_measurements(self):
        router = self.env["print_gateway.print_router"]
        for dpi, dots in ((203, 576), (300, 851), (600, 1702)):
            with self.subTest(dpi=dpi):
                profile = self._geometry(dots, dpi)
                self.assertEqual(router._receipt_width_for_route(self._route(profile)), dots)
                self.assertEqual(router._receipt_geometry_for_route(self._route(profile)), profile)

    def test_actual_router_has_no_geometry_default_for_legacy_or_unbound_printer(self):
        router = self.env["print_gateway.print_router"]
        for profile in (None, {}, {"printable_width_dots": 576},
                        dict(self._geometry(), printer_id="different-printer"),
                        dict(self._geometry(), dpi_x=0)):
            with self.subTest(profile=profile), self.assertRaises(ValidationError):
                router._receipt_width_for_route(self._route(profile))
        with self.assertRaises(ValidationError):
            router._receipt_width_for_route({})

    def test_direct_raster_typography_does_not_invent_media_but_driver_image_requires_it(self):
        router = self.env["print_gateway.print_router"]
        profile = self._geometry()
        del profile["paper_width_mm"]
        self.assertEqual(router._receipt_width_for_route(self._route(profile, "usb")), 576)
        self.assertNotIn("paper_width_mm", router._receipt_geometry_for_route(self._route(profile, "usb")))
        with self.assertRaises(ValidationError):
            router._receipt_geometry_for_route(self._route(profile))

    def test_actual_receipt_routes_bind_exact_image_to_selected_geometry_before_submission(self):
        router = self.env["print_gateway.print_router"]
        Router = type(router)
        image_bytes = BytesIO()
        Image.new("RGB", (16, 16), "white").save(image_bytes, format="JPEG")
        image = base64.b64encode(image_bytes.getvalue()).decode("ascii")
        for method in ("route_pos_receipt", "route_kitchen_print", "route_pos_sale_details"):
            record = MagicMock()
            record.id, record._name, record.company_id = 51, "pos.order", self.env.company
            record.config_id.id = 7
            with self.subTest(method=method), \
                 patch.object(Router, "resolve_binding", return_value=self._route(self._geometry())), \
                 patch.object(Router, "_replay_receipt_operation", return_value=None), \
                 patch.object(Router, "_submit_route", return_value={"status": "queued"}) as submit:
                for reference in (None, "b" * 64):
                    with self.assertRaises(ValidationError):
                        getattr(router, method)(record, image, idempotency_key="same-operation", geometry_fingerprint=reference)
                submit.assert_not_called()
                result = getattr(router, method)(record, image, idempotency_key="same-operation", geometry_fingerprint="a" * 64)
                self.assertEqual(result, {"status": "queued"})
                self.assertEqual(submit.call_args.kwargs["idempotency_key"], "same-operation")
                self.assertEqual(submit.call_args.kwargs["payload"], {
                    "type": "image", "encoding": "base64", "data": image, "geometry_fingerprint": "a" * 64,
                })

    def test_ordinary_driver_document_transport_does_not_require_receipt_geometry(self):
        binding = self.env["print_gateway.binding"]
        self.assertTrue(binding._runtime_printer_accepts_image({"connectionType": "spooler", "protocol": "spooler"}))

    def test_unknown_usb_and_escpos_label_cannot_authorize_raster_commands(self):
        binding = self.env["print_gateway.binding"]
        profile = self._geometry()
        printer = {"id": "geometry-printer", "connectionType": "usb", "protocol": "escpos", "capabilities": {"geometry": profile}}
        self.assertTrue(binding._runtime_printer_accepts_image(printer))
        del profile["raster_command"]
        self.assertFalse(binding._runtime_printer_accepts_image(printer))
        profile["raster_command"] = "gs_v_0"
        printer["protocol"] = "unknown"
        self.assertFalse(binding._runtime_printer_accepts_image(printer))

    @contextmanager
    def _durable_receipt_replay(self, status="submitted", fingerprint="a" * 64):
        """Real committed outbox rows; only enrollment/route discovery are mocked.

        A partner is the native ORM source fixture so source read ACLs are real
        without requiring a separate browser/POS session setup. Public POS
        wrappers retain their own read checks; the private route is the unit
        under test here.
        """
        content = BytesIO()
        Image.new("RGB", (16, 16), "white").save(content, format="JPEG")
        image = base64.b64encode(content.getvalue()).decode("ascii")
        key = uuid.uuid4().hex
        cr = self.env.registry.cursor()
        try:
            env = api.Environment(cr, self.env.uid, dict(self.env.context))
            company = env.company
            with patch.object(PrintGatewayConfig, "_validate_gateway_host"), \
                 patch.object(PrintGatewayConfig, "_register_auto_installation", return_value="synthetic-enrollment"):
                config = env["print_gateway.gateway_config"].sudo().search([("company_id", "=", company.id)], limit=1)
                created_config = not config
                if not config:
                    config = env["print_gateway.gateway_config"].create({
                        "company_id": company.id, "gateway_url": "https://geometry.example.invalid",
                        "gateway_api_key": secrets.token_urlsafe(32), "enabled": True,
                    })
                source = env["res.partner"].create({"name": "Receipt geometry source " + key, "company_id": company.id})
                payload = {"type": "image", "encoding": "base64", "data": image}
                if fingerprint is not None:
                    payload["geometry_fingerprint"] = fingerprint
                job = env["print_gateway.print_job"].create_operation(
                    company=company, gateway_config=config, printer_id="geometry-printer",
                    destination=source.display_name, destination_key="res.partner,%s" % source.id,
                    document_type="receipt", payload=payload, source_model=source._name,
                    source_record_id=source.id, idempotency_key=key,
                )
                job.write({"status": status, "attempts": 2, "gateway_job_id": uuid.uuid4().hex,
                           "last_error": "UNKNOWN_PRINT_OUTCOME: synthetic interrupted execution" if status == "failed" else False})
                ids = (source.id, config.id, job.id)
                cr.commit()
        finally:
            cr.close()
        cr = self.env.registry.cursor()
        try:
            env = api.Environment(cr, self.env.uid, dict(self.env.context))
            source, config, job = (env[model].browse(value) for model, value in zip(
                ("res.partner", "print_gateway.gateway_config", "print_gateway.print_job"), ids))
            fixture_partner_ids = [source.id]
            route = {"native": False, "config": config, "destination": source, "document_type": "receipt",
                     "binding": SimpleNamespace(printer_id="geometry-printer", id=11),
                     "_fixture_partner_ids": fixture_partner_ids}
            yield env["print_gateway.print_router"], source, route, job, image, key
        finally:
            cr.close()
            # These rows were deliberately committed for the fresh-cursor
            # regression. Remove only the fixture's own rows so a later test
            # cannot reconcile them while holding the same config on another
            # cursor. TransactionCase cannot roll back independent commits.
            cleanup_cr = self.env.registry.cursor()
            try:
                cleanup_env = api.Environment(cleanup_cr, self.env.uid, dict(self.env.context))
                cleanup_env["print_gateway.print_job"].sudo().browse(ids[2]).exists().unlink()
                cleanup_env["res.partner"].sudo().browse(fixture_partner_ids).exists().unlink()
                if created_config:
                    cleanup_env["print_gateway.gateway_config"].sudo().browse(ids[1]).exists().unlink()
                cleanup_cr.commit()
            finally:
                cleanup_cr.close()

    def test_persisted_accepted_unknown_and_legacy_receipts_replay_without_live_geometry_or_new_work(self):
        for status, fingerprint in (("submitted", "a" * 64), ("failed", "a" * 64), ("submitted", None)):
            with self.subTest(status=status, fingerprint=fingerprint), self._durable_receipt_replay(status, fingerprint) as case:
                router, source, route, job, image, key = case
                before = (job.payload, job.status, job.attempts, job.gateway_wire_idempotency_key, job.gateway_installation_id)
                with patch.object(type(router), "resolve_binding", return_value=route), \
                     patch.object(type(router), "_receipt_geometry_for_route", side_effect=AssertionError("live geometry must not gate durable replay")), \
                     patch.object(type(router), "_persist_durable_job", side_effect=AssertionError("replay must not persist")), \
                     patch.object(type(router), "_submit_durable_job", side_effect=AssertionError("replay must not submit bytes")):
                    result = router.route_pos_receipt(source, image, idempotency_key=key, geometry_fingerprint=fingerprint)
                self.assertEqual(result["job_id"], job.id)
                self.assertEqual(result["status"], "unknown" if status == "failed" else "submitted")
                self.assertFalse(result["can_retry"])
                job.invalidate_recordset()
                self.assertEqual(before, (job.payload, job.status, job.attempts, job.gateway_wire_idempotency_key, job.gateway_installation_id))
                self.assertEqual(job.search_count([("company_id", "=", source.company_id.id), ("idempotency_key", "=", key)]), 1)

    def test_non_admin_operator_reconciles_exact_accepted_receipt_without_payload_access(self):
        with self._durable_receipt_replay() as case:
            router, source, route, job, image, key = case
            operator = router.env["res.users"].sudo().with_context(no_reset_password=True).create({
                "name": "Receipt replay operator", "login": "receipt_replay_" + key,
                "company_id": source.company_id.id,
                "company_ids": [(6, 0, [source.company_id.id])],
                "group_ids": [(6, 0, [router.env.ref("base.group_user").id,
                                      router.env.ref("point_of_sale.group_pos_user").id])],
            })
            route["_fixture_partner_ids"].append(operator.partner_id.id)
            router.env.cr.commit()
            try:
                restricted = router.with_user(operator).with_company(source.company_id)
                self.assertFalse(restricted.env.su)
                self.assertFalse(restricted.env.user.has_group("base.group_system"))
                visible_job = job.with_env(restricted.env)
                visible_job.check_access("read")
                source.with_env(restricted.env).check_access("read")
                with self.assertRaises(AccessError):
                    visible_job.read(["payload"])
                with patch.object(type(router), "resolve_binding", return_value=route), \
                     patch.object(type(router), "_receipt_geometry_for_route", side_effect=AssertionError("replay must not ask live geometry")), \
                     patch.object(type(router), "_persist_durable_job", side_effect=AssertionError("replay must not persist")), \
                     patch.object(type(router), "_submit_durable_job", side_effect=AssertionError("replay must not submit")):
                    result = restricted.route_pos_receipt(source.with_env(restricted.env), image,
                        idempotency_key=key, geometry_fingerprint="a" * 64)
                self.assertEqual(result["job_id"], job.id)
                self.assertEqual(result["status"], "submitted")
                self.assertFalse(result["can_retry"])
                self.assertNotIn("payload", result)
                with self.assertRaises(AccessError):
                    visible_job.read(["payload"])
            finally:
                operator.sudo().unlink()
                router.env.cr.commit()

    def test_persisted_receipt_replay_conflicts_on_changed_payload_fingerprint_source_or_route(self):
        with self._durable_receipt_replay() as case:
            router, source, route, _job, image, key = case
            alternate = BytesIO()
            Image.new("RGB", (16, 16), "black").save(alternate, format="JPEG")
            other_image = base64.b64encode(alternate.getvalue()).decode("ascii")
            other_source = router.env["res.partner"].create({"name": "Different receipt source", "company_id": source.company_id.id})
            route["_fixture_partner_ids"].append(other_source.id)
            router.env.cr.commit()
            wrong_route = dict(route, binding=SimpleNamespace(printer_id="other-printer", id=12))
            for record, candidate, fingerprint, selected in (
                (source, other_image, "a" * 64, route), (source, image, "b" * 64, route),
                (source, image, None, route), (other_source, image, "a" * 64, route),
                (source, image, "a" * 64, wrong_route),
            ):
                with self.subTest(record=record.id, fingerprint=fingerprint, printer=selected["binding"].printer_id), \
                     patch.object(type(router), "resolve_binding", return_value=selected), \
                     patch.object(type(router), "_receipt_geometry_for_route", side_effect=AssertionError("conflict must precede live geometry")), \
                     self.assertRaisesRegex(ValidationError, "idempotency key"):
                    router.route_pos_receipt(record, candidate, idempotency_key=key, geometry_fingerprint=fingerprint)

    def test_new_receipt_with_an_old_fingerprint_still_fails_before_outbox_creation(self):
        with self._durable_receipt_replay() as case:
            router, source, route, job, image, _key = case
            new_key = uuid.uuid4().hex
            with patch.object(type(router), "resolve_binding", return_value=route), \
                 patch.object(type(router), "_receipt_geometry_for_route", return_value=dict(self._geometry(), config_fingerprint="b" * 64)), \
                 patch.object(type(router), "_persist_durable_job", side_effect=AssertionError("stale image must not persist")), \
                 self.assertRaisesRegex(ValidationError, "geometry changed"):
                router.route_pos_receipt(source, image, idempotency_key=new_key, geometry_fingerprint="a" * 64)
            self.assertEqual(job.search_count([("idempotency_key", "=", new_key)]), 0)

    def test_persisted_receipt_replay_retains_read_acl_company_and_current_route_authorization(self):
        with self._durable_receipt_replay() as case:
            router, source, route, _job, image, key = case
            restricted = router.with_user(router.env.ref("base.public_user"))
            with patch.object(type(router), "resolve_binding", return_value=route), self.assertRaises(AccessError):
                restricted.route_pos_receipt(source.with_env(restricted.env), image, idempotency_key=key, geometry_fingerprint="a" * 64)
            other = router.env["res.company"].search([("id", "!=", source.company_id.id)], limit=1)
            if not other:
                other = router.env["res.company"].create({"name": "Other receipt geometry scope " + uuid.uuid4().hex})
            with patch.object(type(router), "_replay_receipt_operation", side_effect=AssertionError("cross-company replay lookup must not run")), \
                 self.assertRaisesRegex(ValidationError, "active Odoo company"):
                router.with_company(other).route_pos_receipt(source, image, idempotency_key=key, geometry_fingerprint="a" * 64)
            with patch.object(type(router), "resolve_binding", side_effect=ValidationError("Current binding is no longer authorized")), \
                 patch.object(type(router), "_replay_receipt_operation", side_effect=AssertionError("unauthorized replay lookup must not run")), \
                 self.assertRaisesRegex(ValidationError, "no longer authorized"):
                router.route_pos_receipt(source, image, idempotency_key=key, geometry_fingerprint="a" * 64)
