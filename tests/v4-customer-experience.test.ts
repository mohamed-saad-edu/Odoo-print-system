import { documentTypeLabel } from "../src/shared/document-label";
import { describe, expect, it } from "vitest";
import { jobDisplayLabel, jobLabel, jobFailurePresentation, deriveOutcome, UNKNOWN_OUTCOME_MARKERS } from "../src/shared/job-vocabulary";
import { dashboardSubscriptionSummary, fetchDashboardBillingUsage } from "../src/lib/dashboard-billing-usage";
import { v4ExperienceAr, v4ExperienceEn } from "../src/i18n/messages/v4-experience";

describe("V4 truthful customer vocabulary", () => {
  it("uses progress words without inventing physical print evidence", () => {
    expect(jobDisplayLabel("queued", null, "en")).toBe("Waiting");
    for (const state of ["claimed", "printing"]) {
      expect(jobDisplayLabel(state, null, "en")).toBe("Processing");
      expect(deriveOutcome(state)).toBe("unknown");
    }
    expect(jobDisplayLabel("success", null, "en")).toBe("Sent to printer");
    expect(jobDisplayLabel("success", null, "ar")).toBe("أُرسلت إلى الطابعة");
    expect(deriveOutcome("success")).toBe("unknown");
  });
  it.each(UNKNOWN_OUTCOME_MARKERS)("keeps %s uncertain even when secondary diagnostic looks like a safe failure", (marker) => {
    for (const status of ["failed", "expired"]) {
      expect(jobFailurePresentation(`${marker}: CAPABILITY_MISMATCH`, "en")).toBeNull();
      expect(jobDisplayLabel(status, `${marker}: CAPABILITY_MISMATCH`, "en")).toBe("Needs review");
      expect(jobDisplayLabel(status, `${marker}: CAPABILITY_MISMATCH`, "ar")).toBe("تحتاج إلى مراجعة");
    }
  });
  it("only labels evidenced pre-delivery cancellation as canceled", () => {
    expect(jobDisplayLabel("failed", "AGENT_DELETED: Cancelled before delivery by workspace administrator.", "en")).toBe("Canceled");
    expect(jobDisplayLabel("failed", "UNKNOWN_PARTIAL_DELIVERY: Agent deleted during execution", "en")).toBe("Needs review");
    expect(jobDisplayLabel("failed", "CAPABILITY_MISMATCH", "en")).toBe("Failed before output");
    expect(jobDisplayLabel("expired", null, "en")).toBe("Expired before output");
    expect(jobLabel("future_internal_state", undefined, "ar")).toBe("الحالة غير متاحة");
  });
  it("localizes recognized document types while preserving customer document names", () => {
    expect(documentTypeLabel("kitchen_ticket", "ar")).toBe("طلب المطبخ");
    expect(documentTypeLabel("invoice A4", "ar")).toBe("فاتورة A4");
    expect(documentTypeLabel("Customer custom report", "ar")).toBe("Customer custom report");
  });
  it("has complete Arabic copy and matching interpolation variables", () => {
    expect(Object.keys(v4ExperienceAr).sort()).toEqual(Object.keys(v4ExperienceEn).sort());
    for (const key of Object.keys(v4ExperienceEn) as Array<keyof typeof v4ExperienceEn>) {
      expect(v4ExperienceAr[key]).toMatch(/[\u0600-\u06ff]/);
      expect(v4ExperienceAr[key].match(/\{\w+\}/g) ?? []).toEqual(v4ExperienceEn[key].match(/\{\w+\}/g) ?? []);
    }
  });
});

describe("V4 subscription summary privacy and truthfulness", () => {
  it("never translates legacy provider state to an active manual entitlement", () => {
    for (const value of [null, {}, { customerState: "trialing" }, { status: "active" }]) expect(dashboardSubscriptionSummary(value)).toBeNull();
    expect(dashboardSubscriptionSummary({ customerState: "expired", currentPeriodEnd: "invalid" })).toEqual({ customerState: "expired", currentPeriodEnd: null });
  });
  it("displays inactive lifecycle without requesting restricted quota data", async () => {
    const calls: string[] = [];
    const summaries: unknown[] = [];
    const result = await fetchDashboardBillingUsage(async (url) => {
      calls.push(url);
      return Response.json({ hasSubscription: false, customerState: "awaiting_activation", currentPeriodEnd: null });
    }, new AbortController().signal, (summary) => summaries.push(summary));
    expect(calls).toEqual(["/api/billing/status"]);
    expect(result.kind).toBe("unsubscribed");
    expect(summaries).toEqual([{ customerState: "awaiting_activation", currentPeriodEnd: null }]);
  });
  it("lets Full Access members read only lifecycle state, without requesting protected billing usage", async () => {
    const calls: string[] = [];
    const snapshots: unknown[] = [];
    const result = await fetchDashboardBillingUsage(async (url) => {
      calls.push(url);
      if (url !== "/api/billing/status") throw new Error("Non-owner accessed billing details");
      return Response.json({ hasSubscription: true, customerState: "active" });
    }, new AbortController().signal, summary => snapshots.push(summary), false);
    expect(result).toEqual({ kind: "status_only" });
    expect(calls).toEqual(["/api/billing/status"]);
    expect(snapshots).toEqual([{ customerState: "active", currentPeriodEnd: null }]);
  });
    it("does not deliver a late subscription summary after actor scope is canceled", async () => {
    const controller = new AbortController();
    const summaries: unknown[] = [];
    await fetchDashboardBillingUsage(async () => {
      controller.abort();
      return Response.json({ hasSubscription: false, customerState: "active" });
    }, controller.signal, (summary) => summaries.push(summary));
    expect(summaries).toEqual([]);
  });
});
