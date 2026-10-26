import { beforeEach, describe, expect, it, vi } from "vitest";
const navigation = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: navigation.redirect }));
import BillingPage from "../src/app/billing/page";

describe("commercial contract data is Platform Owner-only", () => {
  beforeEach(() => navigation.redirect.mockReset());
  it.each(["en", "ar"] as const)("redirects %s workspace members away from billing, ignoring requested plan parameters", () => {
    const rendered = BillingPage({ searchParams: Promise.resolve({ plan: "secret-plan" }) });
    expect(rendered).toBeNull();
    expect(navigation.redirect).toHaveBeenCalledExactlyOnceWith("/platform/subscriptions");
  });
});
