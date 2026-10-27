/** Read dashboard quota data only after the subscription-status preflight.
 *
 * A missing/expired plan is normal for an onboarding workspace: status returns
 * 200 with hasSubscription=false while the guarded /api/billing/usage endpoint
 * correctly returns 403. This client policy prevents those predictable 403s
 * without changing the API's RBAC or entitlement checks.
 */
export type DashboardSubscriptionSummary = {
  customerState: "awaiting_activation" | "active" | "expired" | "suspended";
  currentPeriodEnd: string | null;
};

export function dashboardSubscriptionSummary(value: unknown): DashboardSubscriptionSummary | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!["awaiting_activation", "active", "expired", "suspended"].includes(String(row.customerState))) return null;
  return {
    customerState: row.customerState as DashboardSubscriptionSummary["customerState"],
    currentPeriodEnd: typeof row.currentPeriodEnd === "string" && Number.isFinite(Date.parse(row.currentPeriodEnd)) ? row.currentPeriodEnd : null,
  };
}

export type DashboardBillingUsageResult<T> =
  | { kind: "available"; usage: T }
  | { kind: "unsubscribed" }
  | { kind: "status_only" }
  | { kind: "forbidden" }
  | { kind: "unavailable" };

export async function fetchDashboardBillingUsage<T>(
  request: (url: string, init: RequestInit) => Promise<Response>,
  signal: AbortSignal,
  onSubscription?: (summary: DashboardSubscriptionSummary | null) => void,
  allowUsage = true,
): Promise<DashboardBillingUsageResult<T>> {
  const init: RequestInit = { credentials: "same-origin", cache: "no-store", signal };
  const status = await request("/api/billing/status", init);
  if (status.status === 401 || status.status === 403) return { kind: "forbidden" };
  if (!status.ok) return { kind: "unavailable" };

  const summary = await status.json().catch(() => null) as unknown;
  if (!summary || typeof summary !== "object" || Array.isArray(summary) ||
      typeof (summary as { hasSubscription?: unknown }).hasSubscription !== "boolean") {
    return { kind: "unavailable" };
  }
  if (!signal.aborted) onSubscription?.(dashboardSubscriptionSummary(summary));
  if (!(summary as { hasSubscription: boolean }).hasSubscription) return { kind: "unsubscribed" };
  // Full Access users can see if printing is paused, but not owner-only usage or terms.
  if (!allowUsage) return { kind: "status_only" };

  const usageResponse = await request("/api/billing/usage", init);
  if (usageResponse.status === 401 || usageResponse.status === 403) return { kind: "forbidden" };
  if (!usageResponse.ok) return { kind: "unavailable" };

  const usage = await usageResponse.json().catch(() => null) as unknown;
  if (!usage || typeof usage !== "object" || Array.isArray(usage) ||
      !("resources" in usage) || !usage.resources || typeof usage.resources !== "object" ||
      !("prints" in usage.resources) || !usage.resources.prints) {
    return { kind: "unavailable" };
  }
  return { kind: "available", usage: usage as T };
}
