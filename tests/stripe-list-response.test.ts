import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripeList } from "../src/lib/stripe";

describe("Stripe list reconciliation evidence", () => {
  beforeEach(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "local-provider-fixture");
    vi.stubEnv("STRIPE_SECRET_KEY_FILE", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([undefined, null, "false", 0])("rejects an unverified pagination flag: %s", async (hasMore) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      object: "list", data: [{ id: "sub_existing" }],
      ...(hasMore === undefined ? {} : { has_more: hasMore }),
    }), { status: 200 })));

    await expect(stripeList("subscriptions")).rejects.toThrow(/pagination/i);
  });

  it.each([false, true])("preserves the provider's verified pagination flag: %s", async (hasMore) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      object: "list", data: [{ id: "sub_existing" }], has_more: hasMore,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await expect(stripeList("subscriptions", new URLSearchParams({ customer: "cus_fixture" })))
      .resolves.toEqual({ data: [{ id: "sub_existing" }], hasMore });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
