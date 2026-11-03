# Hard imports: this module only runs under the Odoo test runner; a fallback
# previously degraded the whole file into silent skips with a green exit.
from odoo.tests import tagged
from odoo.tests.common import TransactionCase


@tagged("post_install", "-at_install")
class TestBindingDisplayName(TransactionCase):
    """Binding display names must read human-first (v12-odoo).

    Regression for a user screenshot where a binding row showed a leading
    truncated opaque identity ("...ter_identity_0b0588b9071f8a34") instead
    of a readable name. The full identity stays in the Printer Identity
    column/field; it must never be the display name.
    """

    def setUp(self):
        super().setUp()
        self.company = self.env.company
        self.branch = self.env["res.company"].create(
            {"name": "Gateway Test Branch", "parent_id": self.company.id}
        )
        self.report = self.env["ir.actions.report"].create(
            {
                "name": "Gateway Test Invoice PDF",
                "model": "account.move",
                "report_type": "qweb-pdf",
                "report_name": "gateway_test.invoice_pdf",
            }
        )

    def _ensure_assignment(self, agent_id):
        assignment_model = self.env["print_gateway.runtime_agent_assignment"]
        existing = assignment_model.search(
            [
                ("company_id", "=", self.company.id),
                ("branch_id", "=", self.branch.id),
                ("runtime_agent_id", "=", agent_id),
            ],
            limit=1,
        )
        return existing or assignment_model.create(
            {
                "company_id": self.company.id,
                "branch_id": self.branch.id,
                "runtime_agent_id": agent_id,
                "enabled": True,
            }
        )

    def _create_binding(self, **extra):
        vals = {
            "company_id": self.company.id,
            "branch_id": self.branch.id,
            "destination_type": "report",
            "destination_report_id": self.report.id,
            "report_id": self.report.id,
            "printer_protocol": "escpos",
            "runtime_agent_id": "agt_t0000001",
            "printer_id": "printer_identity_0b0588b9071f8a34",
            "enabled": True,
            "priority": 10,
        }
        vals.update(extra)
        self._ensure_assignment(vals["runtime_agent_id"])
        return self.env["print_gateway.binding"].create(vals)

    def test_display_name_prefers_printer_name(self):
        binding = self._create_binding(printer_name="Brother MFC-J3940DW")
        expected = "%s / %s / %s → %s" % (
            self.branch.display_name,
            "Invoice",
            self.report.display_name,
            "Brother MFC-J3940DW",
        )
        self.assertEqual(binding.display_name, expected)
        self.assertNotIn("printer_identity", binding.display_name)
        self.assertNotIn("agt_t0000001", binding.display_name)
        # The stored name follows the same human-first format (only the
        # document token stays unlocalized there).
        self.assertEqual(
            binding.name,
            "%s / %s / %s → %s"
            % (
                self.branch.display_name,
                "invoice",
                self.report.display_name,
                "Brother MFC-J3940DW",
            ),
        )

    def test_display_name_falls_back_to_unnamed_label_plus_suffix(self):
        binding = self._create_binding()
        self.assertTrue(binding.display_name.endswith("Unnamed printer …8a34"))
        self.assertNotIn("printer_identity_0b0588b9071f8a34", binding.display_name)
        self.assertNotIn("agt_t0000001", binding.display_name)

    def test_printer_label_without_any_printer(self):
        binding = self.env["print_gateway.binding"].new(
            {"printer_name": False, "printer_id": False}
        )
        self.assertEqual(binding._printer_display_label(), "Printer")
