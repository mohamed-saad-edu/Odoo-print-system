# -*- coding: utf-8 -*-
"""Use Odoo's real report preparation boundary to preserve Unicode tickets."""
from lxml import html as lxml_html
from pathlib import Path

import polib
import re

from odoo.exceptions import ValidationError
from odoo.tests import tagged
from odoo.tests.common import TransactionCase
from odoo.tools.translate import code_translations, xml_translate


@tagged("post_install", "-at_install")
class TestDiagnosticReportEncoding(TransactionCase):
    def test_v5_raw_template_validation_is_fully_localized_in_arabic(self):
        self.env["res.lang"]._activate_lang("ar_001")
        for template in ("{name:>999999999}", "{name", "{name:??}", "{name.__class__}"):
            with self.subTest(template=template):
                policy = self.env["print_gateway.policy"].with_context(lang="ar_001").new({
                    "name": "قاعدة اختبار", "raw_template": template, "raw_protocol": "zpl",
                })
                with self.assertRaises(ValidationError) as raised:
                    policy.render_raw_template(self.env.company)
                self.assertFalse(re.search(r"[A-Za-z]", str(raised.exception)), str(raised.exception))

    def test_catalog_code_terms_are_loaded_by_odoo(self):
        catalog = polib.pofile(str(Path(__file__).resolve().parents[1] / "i18n/ar.po"))
        python_terms = code_translations.get_python_translations("print_gateway", "ar_001")
        javascript_terms = {
            entry["id"]: entry["string"]
            for entry in code_translations.get_web_translations("print_gateway", "ar_001")["messages"]
        }
        for entry in catalog:
            for occurrence, _line in entry.occurrences:
                if not occurrence.startswith("code:"):
                    continue
                loaded = python_terms if occurrence.endswith(".py") else javascript_terms
                self.assertEqual(loaded.get(entry.msgid), entry.msgstr, entry.msgid)

    def test_configuration_display_name_identifies_its_company(self):
        config = self.env["print_gateway.gateway_config"].new({"company_id": self.env.company.id})
        self.assertEqual(config.display_name, self.env.company.display_name)
        for language in ("en_US", "ar_001"):
            job = self.env["print_gateway.print_job"].with_context(lang=language).new({
                "destination": "فاتورة المقهى / Invoice 1042",
            })
            self.assertEqual(job.display_name, job.destination)

    def test_configuration_status_uses_each_readers_language(self):
        self.env["res.lang"]._activate_lang("ar_001")
        config = self.env["print_gateway.gateway_config"].with_context(lang="en_US").new({
            "company_id": self.env.company.id,
        })
        english = config.gateway_sync_message
        arabic = config.with_context(lang="ar_001").gateway_sync_message
        self.assertIn("connection key from Connect Odoo", english)
        self.assertTrue(any("\u0600" <= character <= "\u06ff" for character in arabic))
        self.assertEqual(config.gateway_sync_message, english)
        self.assertEqual(config.gateway_sync_state, "not_configured")

    def test_binding_display_name_uses_the_readers_document_language(self):
        self.env["res.lang"]._activate_lang("ar_001")
        binding = self.env["print_gateway.binding"].with_context(lang="en_US").new({
            "company_id": self.env.company.id,
            "destination_type": "report",
            "destination_report_id": self.env.ref("account.account_invoices").id,
            "report_id": self.env.ref("account.account_invoices").id,
            "runtime_agent_id": "synthetic-agent", "printer_id": "synthetic-printer",
            "printer_protocol": "escpos",
        })
        english = binding.display_name
        arabic = binding.with_context(lang="ar_001").display_name
        self.assertTrue(any("\u0600" <= character <= "\u06ff" for character in arabic))
        self.assertNotEqual(english, arabic)
        self.assertEqual(binding.display_name, english)

    def test_all_shipped_view_terms_have_arabic_translations(self):
        catalog = {
            entry.msgid: entry.msgstr
            for entry in polib.pofile(str(Path(__file__).resolve().parents[1] / "i18n/ar.po"))
            if not entry.obsolete
        }
        view_ids = self.env["ir.model.data"].search([
            ("module", "=", "print_gateway"), ("model", "=", "ir.ui.view"),
        ]).mapped("res_id")
        for view in self.env["ir.ui.view"].browse(view_ids).with_context(lang="en_US"):
            terms = []
            xml_translate(terms.append, view.arch_db)
            for term in terms:
                if any(character.isalpha() for character in term):
                    self.assertTrue(catalog.get(term), "%s: %s" % (view.name, term))

    def test_diagnostic_labels_match_their_translation_terms(self):
        terms = []
        xml_translate(terms.append, self.env.ref("print_gateway.diagnostic_report").with_context(lang="en_US").arch_db)
        for label in ("Company:", "Location:", "Printer:", "Time:"):
            self.assertIn(label, terms)

    def test_thermal_report_retains_utf8_wrapper_assets_and_names(self):
        report = self.env.ref("print_gateway.action_diagnostic_report").with_context(lang="en_US")
        for width in (58, 80):
            with self.subTest(width=width):
                html, report_type = report._render_qweb_html(report.report_name, [], data={
                    "company_name": "المقهى الرئيسي", "branch_name": "فرع الرياض",
                    "printer_name": "طابعة الإيصالات", "now_str": "2026-10-24 12:00:00",
                    "paper_width_mm": width,
                })
                self.assertEqual(report_type, "html")
                bodies, _ids, _header, _footer, _args = report._prepare_html(html)
                self.assertEqual(len(bodies), 1)
                document = lxml_html.fromstring(bodies[0])
                self.assertTrue(
                    document.xpath("//head/meta[translate(@charset, 'UTF', 'utf')='utf-8']"),
                    "Thermal reports must retain the UTF-8 declaration for wkhtmltopdf",
                )
                self.assertTrue(document.xpath("//head/link[@rel='stylesheet']"))
                self.assertIn("المقهى الرئيسي", document.text_content())
                self.assertIn("o_pg_diagnostic_ticket", "".join(document.xpath("//style/text()")))
