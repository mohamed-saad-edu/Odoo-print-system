import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("Yaseir icon asset contract", () => {
  it("uses an Odoo module-root icon path", () => {
    const manifest = read("odoo_addons/print_gateway/__manifest__.py");
    expect(manifest).toContain("'icon': '/print_gateway/static/description/icon.png'");
    expect(manifest).not.toContain("'icon': 'static/description/icon.png'");
  });

  it("keeps the Odoo and desktop PNG assets byte-identical", () => {
    const odoo = readFileSync(join(root, "odoo_addons/print_gateway/static/description/icon.png"));
    const desktop = readFileSync(join(root, "src-tauri/icons/icon.png"));
    expect(odoo.equals(desktop)).toBe(true);
  });

  it("pins the Windows installer and uninstaller to the Yaseir ICO", () => {
    const config = JSON.parse(read("src-tauri/tauri.conf.json")) as {
      bundle?: {
        icon?: string[];
        windows?: { nsis?: { installerIcon?: string; uninstallerIcon?: string } };
      };
    };
    expect(config.bundle?.icon).toContain("icons/icon.ico");
    expect(config.bundle?.windows?.nsis?.installerIcon).toBe("icons/icon.ico");
    expect(config.bundle?.windows?.nsis?.uninstallerIcon).toBe("icons/icon.ico");
  });

  it("keeps the desktop browser icon wired to the same Print Gateway mark", () => {
    const index = read("src/desktop/index.html");
    const desktopIcon = read("src/desktop/icon.svg");
    expect(index).toContain('rel="icon" type="image/svg+xml" href="./icon.svg"');
    // Supplied cyan tile (WP6-BRANDING); the old blue Y glyph is gone.
    // The standalone file keeps the supplier's <style> classes; the
    // inline BrandMarkIcon JSX carries the same fills as attributes.
    expect(desktopIcon).toContain("#00c7fc");
    expect(read("src/components/brand.tsx")).toContain('fill="#00c7fc"');
    expect(desktopIcon).not.toContain("#2563EB");
  });

  it("keeps the Gateway favicon byte-identical to the desktop icon", () => {
    const appIcon = readFileSync(join(root, "src/app/icon.svg"));
    const desktopIcon = readFileSync(join(root, "src/desktop/icon.svg"));
    const tauriSource = readFileSync(join(root, "src-tauri/icons/icon-source.svg"));
    expect(appIcon.equals(desktopIcon)).toBe(true);
    expect(appIcon.equals(tauriSource)).toBe(true);
  });

  it("ships sanitized locale lockups with no script, href, or event handlers", () => {
    for (const file of [
      "public/brand/print-gateway-en.svg",
      "public/brand/print-gateway-ar.svg",
      "public/brand/print-gateway-icon.svg",
      "src/desktop/public/brand/print-agent.svg",
    ]) {
      const svg = read(file);
      expect(svg).not.toMatch(/<script/i);
      expect(svg).not.toMatch(/href\s*=/i);
      expect(svg).not.toContain("xmlns:xlink");
      expect(svg).not.toMatch(/\son\w+\s*=/i);
      expect(svg).not.toContain("<text");
    }
    // Locale geometry: EN lockup icon on the left, AR lockup icon on the right.
    expect(read("public/brand/print-gateway-en.svg")).toContain('viewBox="0 0 946.67 246"');
    expect(read("public/brand/print-gateway-ar.svg")).toContain('viewBox="0 0 813.44 245.33"');
  });

  it("resolves every icon path tauri.conf.json references to a real file", () => {
    const config = JSON.parse(read("src-tauri/tauri.conf.json")) as {
      bundle?: {
        icon?: string[];
        windows?: { nsis?: { installerIcon?: string; uninstallerIcon?: string } };
      };
    };
    const paths = [
      ...(config.bundle?.icon ?? []),
      config.bundle?.windows?.nsis?.installerIcon,
      config.bundle?.windows?.nsis?.uninstallerIcon,
    ].filter((p): p is string => typeof p === "string");
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(() => readFileSync(join(root, "src-tauri", p))).not.toThrow();
    }
  });

  it("renders the locale lockup through the shared BrandMark component", () => {
    const brand = read("src/components/brand.tsx");
    expect(brand).toContain("/brand/print-gateway-en.svg");
    expect(brand).toContain("/brand/print-gateway-ar.svg");
    expect(brand).toContain("brand-lockup-ltr");
    expect(brand).toContain("brand-lockup-rtl");
    expect(brand).not.toContain("YaseirGlyph");
  });
});
