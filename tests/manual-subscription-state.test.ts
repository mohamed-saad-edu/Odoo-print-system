import { describe, expect, it } from "vitest";
import { customerSubscriptionState } from "../src/lib/manual-subscriptions";

const now = Date.parse("2026-10-26T12:00:00Z");
const active = { status: "active", currentPeriodStart: new Date(now - 1000), currentPeriodEnd: new Date(now + 1000) };

describe("manual subscription availability agrees with runtime admission", () => {
  it("keeps explicitly activated manual contracts live within their term", () => {
    expect(customerSubscriptionState(active, "active", now)).toBe("active");
  });
  it("fails closed for invalid Date objects instead of comparing NaN", () => {
    expect(customerSubscriptionState({ ...active, currentPeriodStart: new Date(NaN) }, "active", now)).not.toBe("active");
    expect(customerSubscriptionState({ ...active, currentPeriodEnd: new Date(NaN) }, "active", now)).not.toBe("active");
  });
  it("retains open-ended legacy manual contracts and respects suspension and boundaries", () => {
    expect(customerSubscriptionState({ ...active, currentPeriodEnd: null }, "active", now)).toBe("active");
    expect(customerSubscriptionState(active, "suspended", now)).toBe("suspended");
    expect(customerSubscriptionState({ ...active, currentPeriodEnd: new Date(now) }, "active", now)).toBe("expired");
    expect(customerSubscriptionState({ ...active, currentPeriodStart: new Date(now + 1) }, "active", now)).toBe("awaiting_activation");
  });
});
