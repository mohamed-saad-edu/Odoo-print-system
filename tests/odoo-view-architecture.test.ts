import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("Odoo 19 view architecture contract — gateway_config_views.xml", () => {
  it("keeps the setup form native to Odoo 19 and free of legacy conditional markup", () => {
    const xml = read("odoo_addons/print_gateway/views/gateway_config_views.xml");
    const formStart = xml.indexOf('id="view_print_gateway_config_form"');
    const listStart = xml.indexOf('id="view_print_gateway_config_list"');
    const formEnd = xml.indexOf('<record id="view_print_gateway_config_search"', formStart);
    const formSection = xml.slice(formStart, formEnd);
    const listSection = xml.slice(listStart, formStart);

    // Odoo 19 form views use regular view attributes; this module does not
    // inject QWeb conditionals into the configuration form.
    expect(formSection).not.toContain("t-if=");
    expect(formSection).not.toContain("t-att-class");
    expect(formSection).not.toContain("t-attf-class");

    // The setup form exposes only persisted operator-facing configuration.
    expect(formSection).toContain('field name="company_id" string="Company"');
    expect(formSection).toContain('field name="enabled" widget="boolean_toggle" string="Enable printing"');
    expect(formSection).toContain('field name="gateway_url"');
    expect(formSection).toMatch(/field name="gateway_api_key"[^>]*password="True"/);
    expect(formSection).toContain('field name="last_test_status"');
    expect(formSection).toContain('field name="gateway_sync_state" widget="statusbar"');
    expect(formSection).toContain('field name="gateway_sync_message"');
    expect(formSection).toContain("<header>");

    // The list shows the same operator-level connection state and does not
    // expose the internal reconciliation state machine.
    expect(listSection).toContain('string="Connection"');
    expect(listSection).toContain('name="last_test_status"');
    expect(listSection).not.toContain('name="gateway_sync_state"');
  });

  it("exposes explicit synchronization recovery while hiding unrelated internal actions", () => {
    const xml = read("odoo_addons/print_gateway/views/gateway_config_views.xml");
    const formStart = xml.indexOf('id="view_print_gateway_config_form"');
    const formEnd = xml.indexOf('<record id="view_print_gateway_config_search"', formStart);
    const formSection = xml.slice(formStart, formEnd);

    expect(formSection).toContain('name="action_retry_enabled_sync"');
    expect(formSection).toContain('name="action_reset_stale_sync_state"');
    expect(formSection).toContain('confirm="Recover synchronization state');
    for (const action of [
      'name="action_open_pairing_wizard"',
      'name="action_clear_api_key"',
    ]) {
      expect(formSection).not.toContain(action);
    }
    const advanced = formSection.slice(formSection.indexOf('<page string="Advanced connection settings"'));
    expect(advanced).toContain('name="action_open_runtime_assignments"');
    expect(advanced).toContain('name="action_reset_stale_sync_state"');
    expect(formSection).toContain('name="action_open_printers"');
    expect(formSection).toContain('name="action_open_destinations"');
    expect(formSection).not.toContain('name="action_open_print_rules"');
  });

  it("keeps the Odoo 19 configuration state readable through connection status", () => {
    const xml = read("odoo_addons/print_gateway/views/gateway_config_views.xml");
    const listStart = xml.indexOf('id="view_print_gateway_config_list"');
    const formStart = xml.indexOf('id="view_print_gateway_config_form"');
    const listSection = xml.slice(listStart, formStart);

    expect(listSection).toContain('widget="badge"');
    expect(listSection).toContain('decoration-success="last_test_status == \'success\'"');
    expect(listSection).toContain('decoration-danger="last_test_status in (\'failed\', \'revoked\')"');
    expect(listSection).toContain('decoration-muted="last_test_status == \'draft\'"');
  });
});

describe("Odoo 19 module layout contract — full-width pages", () => {
  it("renders module forms at full viewport width with a centered sheet, at any screen size or zoom", () => {
    // Odoo caps .o_form_sheet at a fixed pixel max-width; the module opts its
    // forms out through the .o_pg_view class carried by every print_gateway
    // form view. The pairing wizard is a modal and keeps its compact layout.
    const scss = read("odoo_addons/print_gateway/static/src/scss/print_gateway_backend.scss");
    expect(scss).toContain(".o_pg_view.o_form_view:not(.o_pg_pairing_wizard) .o_form_sheet_bg .o_form_sheet");
    expect(scss).toContain("max-width: 100%");
    // The stylesheet must stay registered as a backend asset or the rule dies.
    const manifest = read("odoo_addons/print_gateway/__manifest__.py");
    expect(manifest).toContain("print_gateway_backend.scss");
  });

  it("opts every native business list and form into addon readability without moving report assets", () => {
    for (const file of [
      "binding_views.xml",
      "gateway_config_views.xml",
      "print_policy_views.xml",
      "print_job_views.xml",
      "print_intent_views.xml",
      "runtime_assignment_views.xml",
    ]) {
      const xml = read(`odoo_addons/print_gateway/views/${file}`);
      const views = Array.from(xml.matchAll(/<(form|list)\b[^>]*>/g));
      expect(views.length, file).toBeGreaterThan(0);
      for (const [tag, type] of views) {
        expect(tag, `${file}: ${type}`).toMatch(type === "form" ? /class="[^"]*\bo_pg_view\b/ : /class="[^"]*\bo_pg_list\b/);
      }
    }
    const manifest = read("odoo_addons/print_gateway/__manifest__.py");
    const posAssets = manifest.slice(manifest.indexOf("'point_of_sale._assets_pos'"), manifest.indexOf("'web.assets_backend'"));
    expect(posAssets).toContain("receipt_raster.css");
    expect(posAssets).not.toContain("print_gateway_tokens.scss");
    expect(posAssets).not.toContain("print_gateway_backend.scss");
  });

  it("keeps pairing dialogs and keyboard errors connected to native controls", () => {
    const scss = read("odoo_addons/print_gateway/static/src/scss/print_gateway_backend.scss");
    expect(scss).toMatch(/\.o_pg_view\.o_pg_pairing_wizard\s*\{\s*min-height:\s*0/);
    expect(scss).toMatch(/\.o_pg_view,\s*\.o_pg_list,\s*\.o_pg_kanban\s*\{\s*:focus-visible/);
    for (const name of ["agent", "printer"]) {
      const widget = read(`odoo_addons/print_gateway/static/src/components/runtime_${name}_field.js`);
      expect(widget).toContain('class="o_pg_picker_feedback mt-1 d-flex');
      expect(widget).toContain('t-att-aria-describedby="state.error ? errorId : undefined"');
      expect(widget).toContain('t-att-id="errorId"');
      expect(widget).toContain('type="button" class="btn btn-link btn-sm p-0" t-on-click="retryLoad"');
    }
  });
});


describe("Odoo concise connection guidance", () => {
  it("keeps the connection and enable-printing requirements accessible on demand", () => {
    const xml = read("odoo_addons/print_gateway/views/gateway_config_views.xml");
    expect(xml).toContain('<details class="mb-3">');
    expect(xml).toContain('<details class="mb-2">');
    expect(xml).toContain('string="Enable printing"');
    expect(xml).toContain('name="action_test_connection"');
  });
});

describe("Customer navigation keeps printer destinations and automation separate", () => {
  it("shows document destinations before automation and keeps diagnostics advanced", () => {
    const menu = read("odoo_addons/print_gateway/views/menu.xml");
    const destination = menu.split("\n").find(row => row.includes('id="menu_print_gateway_bindings"')) || "";
    const automation = menu.split("\n").find(row => row.includes('id="menu_print_gateway_policies"')) || "";
    const intents = menu.split("\n").find(row => row.includes('id="menu_print_gateway_intents"')) || "";
    expect(destination).toContain('parent="menu_print_gateway_main"');
    expect(destination).toContain('sequence="30"');
    expect(automation).toContain('sequence="40"');
    expect(intents).toContain('parent="menu_print_gateway_advanced"');
    const binding = read("odoo_addons/print_gateway/views/binding_views.xml");
    const policy = read("odoo_addons/print_gateway/views/print_policy_views.xml");
    expect(binding).toContain('<form string="Document Destination"');
    expect(binding).toContain('string="Check registration"');
    expect(binding).toContain('string="Print test page"');
    expect(policy).toContain('string="Document Destination"');
    expect(read("odoo_addons/print_gateway/views/print_job_views.xml")).toContain('<field name="name">Print Activity</field>');
  });
});

describe("Odoo UX localization contract", () => {
  it("uses one Arabic label for document destinations across menus, forms, and actions", () => {
    const po = read("odoo_addons/print_gateway/i18n/ar.po");
    expect(po).toMatch(/msgid "Document Destinations"\nmsgstr "وجهات المستندات"/);
    expect(po).toContain('msgid "No computer assigned to this company or branch"');
    expect(po).toContain('msgid "Assigned Print Agent is unavailable');
  });
});
