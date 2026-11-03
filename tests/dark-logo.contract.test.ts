import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * v11-darklogo — dark-mode lockup + dashboard tab-strip removal contract.
 *
 * Pins the fix for the user's dark-mode screenshots: the Gateway lockup
 * used to sit on a white chip in BOTH modes (a glaring white block on
 * near-black headers/sidebars). It now has a dedicated white-text dark
 * variant, switched by [dir] x [data-theme] in CSS (live with the theme
 * toggle, server-component safe), and the wrapper is clearspace only —
 * no background, no ring, in either mode. The dashboard secondary tab
 * strip is deleted entirely: the sidebar already owns those routes.
 */
const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

function viewBox(svg: string): [number, number] {
  const m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!m) throw new Error("no viewBox");
  return [parseFloat(m[1]), parseFloat(m[2])];
}

function styleBlock(svg: string): string {
  const m = svg.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1] : "";
}

describe("dark-mode lockup contract (v11-darklogo)", () => {
  it("ships dark lockup variants with identical geometry and white text", () => {
    for (const lang of ["en", "ar"]) {
      const light = read(`public/brand/print-gateway-${lang}.svg`);
      const dark = read(`public/brand/print-gateway-${lang}-dark.svg`);
      // Same artwork, same proportions — never stretched or cropped.
      expect(viewBox(dark)).toEqual(viewBox(light));
      // Icon colors come from the stylesheet classes and must not change.
      expect(styleBlock(dark)).toBe(styleBlock(light));
      // Text paths are the unclassed shapes: in the dark variant every
      // one is filled white (main line and subline alike).
      expect(dark).toContain('fill="#ffffff"');
      expect(dark).not.toContain('fill="#000000"');
      expect(dark).not.toContain('fill="black"');
    }
  });

  it("renders light and dark lockups and switches them by dir x data-theme", () => {
    const brand = read("src/components/brand.tsx");
    expect(brand).toContain("/brand/print-gateway-en.svg");
    expect(brand).toContain("/brand/print-gateway-ar.svg");
    expect(brand).toContain("/brand/print-gateway-en-dark.svg");
    expect(brand).toContain("/brand/print-gateway-ar-dark.svg");
    expect(brand).toContain("brand-lockup-ltr-dark");
    expect(brand).toContain("brand-lockup-rtl-dark");
    // Clearspace wrapper only: padding kept, background and ring gone.
    expect(brand).toContain("brand-lockup-chip inline-flex shrink-0 items-center rounded-md p-3");
    expect(brand).not.toContain("bg-white p-3");
    expect(brand).not.toContain("ring-black");

    const css = read("src/app/globals.css");
    // Light pair, dark pair, and the dir + theme combinations.
    expect(css).toContain(".brand-lockup-ltr-dark");
    expect(css).toContain(".brand-lockup-rtl-dark");
    expect(css).toContain('[data-theme="dark"] .brand-lockup-ltr-dark');
    expect(css).toContain('[data-theme="dark"] .brand-lockup-rtl-dark');
    expect(css).toContain('[dir="rtl"][data-theme="dark"] .brand-lockup-rtl-dark');
  });

  it("keeps the icon-only mark usable on dark (cyan tile, unchanged)", () => {
    const brand = read("src/components/brand.tsx");
    expect(brand).toContain("BrandMarkIcon");
    expect(brand).toContain('fill="#00c7fc"');
  });

  it("deletes the dashboard secondary tab strip; the sidebar keeps the routes", () => {
    const client = read("src/app/dashboard/dashboard-client.tsx");
    expect(client).not.toContain("DASHBOARD_VIEWS.map((item)");
    expect(client).not.toContain("rounded-xl border border-edge bg-surface p-2");
    // No dead routes: the sidebar still links every stripped destination.
    const shell = read("src/components/AppShell.tsx");
    for (const href of ['"/dashboard"', '"/agents"', '"/printers"', '"/jobs"']) {
      expect(shell).toContain(href);
    }
    // The hash deep-link redirect survives (old bookmarks still land).
    expect(client).toContain("router.replace(`/${hash}`)");
  });
});
