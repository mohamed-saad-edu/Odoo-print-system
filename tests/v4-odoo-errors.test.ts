import { describe, expect, it } from "vitest";
// @ts-expect-error Odoo JS is exercised through the existing @web test adapter.
import { gatewayServerMessage, parseGatewayBillingLimit, showGatewayBillingLimitDialog } from "../odoo_addons/print_gateway/static/src/js/gateway_limit_dialog";

describe("V4 Odoo customer error boundary", () => {
  it("never displays raw remote exception text, SQL, or credential material", () => {
    const value = gatewayServerMessage({ data: { message: "SQL error password=VERY_PRIVATE_SECRET" } });
    expect(value).toBeTruthy();
    expect(value).not.toMatch(/SQL|password|VERY_PRIVATE_SECRET/);
  });
  it("translates a stable printer code into actionable customer guidance", () => {
    expect(gatewayServerMessage({ data: { message: "PRINTER_OFFLINE: raw Windows error 0x0000709" } })).toBe(
      "The selected printer is unavailable. Check its computer, power and connection before trying again.",
    );
  });
  it("preserves uncertainty instead of promising no physical output", () => {
    const value = gatewayServerMessage({ message: "UNKNOWN_SUBMISSION_OUTCOME: disconnected" });
    expect(value).toContain("Check the printer");
    expect(value).not.toContain("Nothing was printed");
  });
  it("explains that an explicitly rejected POS receipt must be deliberately reprinted", () => {
    const details = parseGatewayBillingLimit('GATEWAY_BILLING_LIMIT:{"entitlement":"max_prints_per_period","limit":100,"used":100,"manualReprintRequired":true,"message":"PRIVATE"}');
    expect(details?.manualReprintRequired).toBe(true);
    let dialog: { body: string } | undefined;
    showGatewayBillingLimitDialog({ services: { dialog: { add(_type: unknown, options: { body: string }) { dialog = options; } } } }, details);
    expect(dialog?.body).toContain("reprint it explicitly only if still needed");
    expect(dialog?.body).not.toContain("PRIVATE");
  });

  it("validates direct RPC billing details before showing any dialog", () => {
    const dialogs: { body: string }[] = [];
    const env = { services: { dialog: { add(_type: unknown, options: { body: string }) { dialogs.push(options); } } } };
    // A direct RPC object does not pass through parseGatewayBillingLimit.
    // Inherited Object.prototype keys must never be accepted as entitlements.
    expect(showGatewayBillingLimitDialog(env, { entitlement: "__proto__", message: "forged", used: 5, limit: 5 })).toBe(false);
    expect(dialogs).toHaveLength(0);
    // A partial but valid signal must still show actionable local copy, rather
    // than throwing when a counter is absent (or echoing a backend message).
    expect(showGatewayBillingLimitDialog(env, { entitlement: "max_prints_per_period", message: "INTERNAL_BILLING_SECRET" })).toBe(true);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].body).toContain("monthly");
    expect(dialogs[0].body).not.toContain("INTERNAL_BILLING_SECRET");
    expect(dialogs[0].body).not.toContain("Used:");
    expect(dialogs[0].body).not.toContain("Allowance:");
  });

  it("uses local quota wording and ignores backend English in structured limit details", () => {
    const details = parseGatewayBillingLimit('GATEWAY_BILLING_LIMIT:{"entitlement":"max_prints_per_period","limit":100,"used":100,"message":"INTERNAL_BACKEND_SECRET"}');
    expect(details.message).not.toContain("INTERNAL_BACKEND_SECRET");
    let dialog: { body: string } | undefined;
    showGatewayBillingLimitDialog({ services: { dialog: { add(_type: unknown, options: { body: string }) { dialog = options; } } } }, details);
    expect(dialog?.body).toContain("monthly");
    expect(dialog?.body).not.toContain("next month");
    expect(dialog?.body).not.toContain("INTERNAL_BACKEND_SECRET");
  });
  it("trusts the definite Gateway rejection code over unrelated traceback markers", () => {
    const quota = gatewayServerMessage({
      message: "Odoo Server Error",
      data: { code: "PRINT_QUOTA_EXCEEDED", message: "UNKNOWN_SUBMISSION_OUTCOME in a previous attempt's traceback" },
    });
    expect(quota).toContain("monthly allowance");
    expect(quota).not.toContain("Check the printer");

    const unknown = gatewayServerMessage({
      message: "Odoo Server Error",
      data: { code: "UNKNOWN_SUBMISSION_OUTCOME", message: "PRINT_QUOTA_EXCEEDED from an unrelated log line" },
    });
    expect(unknown).toContain("Check the printer");
    expect(unknown).not.toContain("monthly allowance");
  });

  it("parses a bounded structured quota marker before a trailing RPC traceback", () => {
    const marker = JSON.stringify({
      code: "PRINT_QUOTA_EXCEEDED", entitlement: "max_prints_per_period",
      limit: 20, used: 20, manualReprintRequired: true,
      message: "PRIVATE_BACKEND_SECRET {quoted object text}",
    });
    const error = { message: "Odoo Server Error", data: {
      message: `ValidationError: GATEWAY_BILLING_LIMIT:${marker}\\nRPC traceback: UNKNOWN_OLD_OPERATION`,
    } };
    const details = parseGatewayBillingLimit(error);
    expect(details).toMatchObject({
      code: "PRINT_QUOTA_EXCEEDED", entitlement: "max_prints_per_period",
      used: 20, limit: 20, manualReprintRequired: true,
    });
    expect(details?.message).not.toContain("PRIVATE_BACKEND_SECRET");
    expect(details?.message).not.toContain("UNKNOWN_OLD_OPERATION");
  });

});
