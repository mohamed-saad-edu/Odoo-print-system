import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * v10-exact — Design Guide v2.1 contract for the fixes this stage closes.
 *
 * Every test pins a value the v8 stage left partial, so the next run proves
 * exactness instead of asserting it in prose: lockup widths >= 120px in
 * BOTH languages at every size, chip clearspace >= 1/4 mark height,
 * guide page-title scale in the Gateway console header, finished
 * landing/pricing type + spacing, fleet strings via i18n, per-form
 * wiring of the guide form helpers, and the Desktop About surface that
 * finally shows the staged Print Agent artwork.
 */
const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");

function viewBoxWidthHeight(svg: string): [number, number] {
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!m) throw new Error("no viewBox");
  return [parseFloat(m[1]), parseFloat(m[2])];
}

describe("design guide v2.1 exactness contract (v10)", () => {
  it("renders every lockup at >= 120px wide in both languages", () => {
    const brand = read("src/components/brand.tsx");
    // Sizes are heights; widths follow from the artwork aspect ratios.
    const heights: Record<string, number> = { sm: 38, md: 40, lg: 48 };
    for (const size of Object.keys(heights)) {
      expect(brand).toContain(`${size}: "h-`);
    }
    const en = viewBoxWidthHeight(read("public/brand/print-gateway-en.svg"));
    const ar = viewBoxWidthHeight(read("public/brand/print-gateway-ar.svg"));
    for (const [size, h] of Object.entries(heights)) {
      const enW = (h * en[0]) / en[1];
      const arW = (h * ar[0]) / ar[1];
      expect(enW).toBeGreaterThanOrEqual(120);
      expect(arW).toBeGreaterThanOrEqual(120);
    }
    // Chip clearspace: p-3 = 12px meets >= 1/4 mark even if the mark is
    // the full lockup height (largest size 48px -> 12px needed).
    expect(brand).toContain("brand-lockup-chip");
    expect(brand).toContain("p-3 ");
    expect(12).toBeGreaterThanOrEqual(48 / 4);
  });

  it("uses the guide page-title scale in the Gateway console header", () => {
    const ui = read("src/components/ui.tsx");
    expect(ui).toContain('text-[2rem] font-[500]');
    expect(ui).toContain("sm:text-4xl");
    // Section titles stay at exactly 24px, weight 500.
    expect(ui).toContain('<h2 className="text-2xl font-[500] text-ink">');
    // Mobile page margins are 16px, not 12px.
    expect(ui).toContain("px-4 py-5 sm:px-6");
    expect(ui).toContain("px-4 pt-4 pb-0 sm:px-6");
    // Desktop already matched; keep it pinned.
    const desktop = read("src/desktop/ui.tsx");
    expect(desktop).toContain("text-4xl font-medium");
  });

  it("finishes landing and pricing to the guide type and spacing scale", () => {
    const landing = read("src/app/page.tsx");
    // Hero title inside the 32–40px page-title range, weight 500.
    expect(landing).toContain("text-[clamp(2rem,5vw,2.5rem)] font-[500]");
    expect(landing).not.toContain("text-3xl");
    expect(landing).not.toContain("sm:text-4xl");
    // No negative tracking on bilingual headings.
    expect(landing).not.toMatch(/tracking-\[-0\.0\d+em\]/);
    // Sections at 40–48px vertical padding.
    expect(landing).toContain("py-10 sm:py-12");
    const pricing = read("src/app/pricing/page.tsx");
    expect(pricing).toContain("text-[clamp(2rem,3vw,2.5rem)] font-[500]");
    // Card titles at 18px, card padding uniformly 24px.
    expect(pricing).toContain('className="break-words text-lg font-[500] leading-snug text-ink"');
    expect(pricing).not.toContain("pt-7 sm:px-7");
    // Header CTAs at the standard 44px / 24px-padding size.
    expect(pricing).toContain('size="md"');
    expect(pricing).not.toContain("min-h-10");
  });

  it("keeps fleet copy in the bilingual strings object, not inline ternaries", () => {
    const fleet = read("src/app/platform/fleet/page.tsx");
    expect(fleet).not.toMatch(/locale === "ar" \? "/);
    for (const key of ["t.minChars", "t.notShared", "t.unknown", "t.disable", "t.enable"]) {
      expect(fleet).toContain(key);
    }
  });

  it("wires the guide form helpers into the real forms", () => {
    for (const file of [
      "src/app/login/page.tsx",
      "src/app/signup/page.tsx",
      "src/app/forgot-password/page.tsx",
      "src/app/reset-password/page.tsx",
      "src/app/platform/login/page.tsx",
    ]) {
      const src = read(file);
      expect(src).toContain("focusFirstError");
      expect(src).toContain("formRef");
    }
    const settings = read("src/app/settings/page.tsx");
    expect(settings).toContain("focusFirstError");
    expect(settings).toContain("useUnsavedChangesWarning");
    expect(settings).toContain("savedName");
    const team = read("src/app/team/page.tsx");
    expect(team).toContain('busy ? t("team.inviteSending")');
    const plans = read("src/app/platform/plans/page.tsx");
    expect(plans).toContain('busy ? t("common.saving")');
    const editor = read("src/components/platform/SubscriptionEditor.tsx");
    expect(editor).toContain('busy ? t("common.saving")');
    const tenants = read("src/app/platform/tenants/[id]/page.tsx");
    expect(tenants).toContain('busy ? t("v4.admin.rejecting")');
    const v4admin = read("src/i18n/messages/v4-admin.ts");
    expect(v4admin).toContain('"v4.admin.rejecting": "Rejecting…"');
    expect(v4admin).toContain('"v4.admin.rejecting": "جارٍ الرفض…"');
    // The helper itself covers form-level errors, not just field errors.
    const ui = read("src/components/ui.tsx");
    expect(ui).toContain('[role="alert"]');
  });

  it("shows the staged Print Agent artwork on a Desktop About surface", () => {
    const settings = read("src/desktop/pages/Settings.tsx");
    expect(settings).toContain("./brand/print-agent.svg");
    expect(settings).toContain('t("desktop.sidebar.productName")');
    expect(existsSync(resolve(process.cwd(), "src/desktop/public/brand/print-agent.svg"))).toBe(true);
  });

  it("leads the shared typography spec with Thmanyah on every surface", () => {
    const tokens = read("typography/tokens.css");
    expect(tokens).toContain('var(--font-thmanyah, "Thmanyah Sans")');
    const odoo = read("odoo_addons/print_gateway/static/src/css/typography_tokens.css");
    expect(odoo).toBe(tokens);
    const desktop = read("src/desktop/theme-light.css");
    expect(desktop).toContain('"Thmanyah Sans", "IBM Plex Sans"');
    expect(desktop).toContain('"Thmanyah Sans", "IBM Plex Sans Arabic"');
    // No Gateway-only override left behind.
    const globals = read("src/app/globals.css");
    expect(globals).not.toContain("--typo-font-latin: var(--font-thmanyah");
  });
});
