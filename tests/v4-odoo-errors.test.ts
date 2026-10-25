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
  it("uses local quota wording and ignores backend English in structured limit details", () => {
    const details = parseGatewayBillingLimit('GATEWAY_BILLING_LIMIT:{"entitlement":"max_prints_per_period","limit":100,"used":100,"message":"INTERNAL_BACKEND_SECRET"}');
    expect(details.message).not.toContain("INTERNAL_BACKEND_SECRET");
    let dialog: { body: string } | undefined;
    showGatewayBillingLimitDialog({ services: { dialog: { add(_type: unknown, options: { body: string }) { dialog = options; } } } }, details);
    expect(dialog?.body).toContain("month");
    expect(dialog?.body).not.toContain("INTERNAL_BACKEND_SECRET");
  });
});
