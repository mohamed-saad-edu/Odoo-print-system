import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { printerPresentation } from "../src/shared/printer-presentation";
import { en } from "../src/i18n/messages/en";
import { ar } from "../src/i18n/messages/ar";

const read = (path: string) => readFileSync(path, "utf8");

/**
 * WP8 UX contract: Agents / Printers / Jobs are first-class sidebar
 * pages, every sidebar/topbar/palette href resolves to a real route,
 * old /dashboard#… anchors are gone from live code, and the printer
 * states the UI promises (not-shared, agent-unavailable) are produced
 * by the shared presentation mapping — not by badge colour alone.
 * This is a code/test-level contract: real-browser visual, mobile
 * drawer and on-device Windows checks stay manual (see UX.md).
 */
describe("WP8 sidebar navigation", () => {
  it("lists Agents, Printers and Jobs as Operations sidebar entries with a command-palette route", () => {
    const shell = read("src/components/AppShell.tsx");
    for (const route of ["/dashboard", "/agents", "/printers", "/jobs"]) {
      expect(shell).toContain(`href: "${route}"`);
    }
    // The three new entries sit in the Operations group, before the
    // Integration entry, in the same NAV_ITEMS list the drawer renders.
    const operations = shell.indexOf('sectionKey: "nav.section.operations"');
    expect(operations).toBeGreaterThan(-1);
    expect(shell.indexOf('href: "/agents"')).toBeGreaterThan(operations);
    expect(shell.indexOf('href: "/api-keys"')).toBeGreaterThan(shell.indexOf('href: "/jobs"'));
    expect(shell).toContain('id: "action-new-agent"');
    expect(shell).toContain('href: "/agents"');
    expect(shell).not.toContain("/dashboard#");
    // No top-bar Agents/Printers link: the Gateway shell renders a
    // sidebar rail + MobileAppBar only; TopNavbar stays unrendered.
    expect(shell).not.toContain("<TopNavbar");
    expect(shell).toContain("<MobileAppBar");
  });

  it("gives each new page the shared server gate and a locked view", () => {
    for (const [route, view] of [["agents", "agents"], ["printers", "printers"], ["jobs", "jobs"]] as const) {
      const page = read(`src/app/${route}/page.tsx`);
      expect(page).toContain("DashboardPageContent");
      expect(page).toContain(`view="${view}"`);
      expect(page).toContain("locked");
    }
    const shared = read("src/app/dashboard/dashboard-page-content.tsx");
    for (const permission of ['"agents.read"', '"printers.read"', '"jobs.read"']) {
      expect(shared).toContain(permission);
    }
    expect(shared).toContain("lockedView={locked ? view : undefined}");
    expect(shared).toContain("BreadcrumbTrail");
    // Old dashboard entry points redirect instead of rendering a view.
    const dashboard = read("src/app/dashboard/page.tsx");
    expect(dashboard).toContain('redirect(`/${requestedView}`)');
    expect(dashboard).toContain("DashboardPageContent");
  });

  it("keeps the dashboard client route-based: tabs are routes, locked pages hide the strip, hashes redirect", () => {
    const client = read("src/app/dashboard/dashboard-client.tsx");
    expect(client).toContain("lockedView");
    expect(client).toContain("{!lockedView && <nav");
    expect(client).toContain('href={item === "home" ? "/dashboard" : `/${item}`}');
    expect(client).toContain('href="/printers"');
    expect(client).toContain('href="/jobs"');
    expect(client).toContain("router.replace(`/${hash}`)");
    expect(client).not.toContain('href="#printers"');
    expect(client).not.toContain('href="#jobs"');
    expect(client).not.toContain('href={`#${item}`}');
  });

  it("audits every static sidebar/client/page href against a real route file", () => {
    const sources = [
      "src/components/AppShell.tsx",
      "src/app/dashboard/dashboard-client.tsx",
      "src/app/api-keys/page.tsx",
      "src/app/page.tsx",
      "src/app/platform/layout.tsx",
    ];
    const hrefs = new Set<string>();
    for (const source of sources) {
      const text = read(source);
      for (const match of text.matchAll(/href="(\/[^"#?]+)"/g)) hrefs.add(match[1]);
      for (const match of text.matchAll(/href:"(\/[^"]+)"/g)) hrefs.add(match[1]);
    }
    expect(hrefs.size).toBeGreaterThan(5);
    for (const href of hrefs) {
      const route = href === "/" ? "" : href;
      expect(existsSync(`src/app${route}/page.tsx`), `no route file for sidebar/client href ${href}`).toBe(true);
    }
    // The audit above covers the live hrefs; these three must be among them.
    for (const route of ["/agents", "/printers", "/jobs"]) expect(hrefs.has(route)).toBe(true);
  });

  it("gives the new and changed strings EN+AR parity", () => {
    const keys = [
      "nav.jobs",
      "dashboard.page.agentsDescription",
      "dashboard.page.printersDescription",
      "dashboard.page.jobsDescription",
      "printer.emptyHowToFind",
      "printer.notSharedTitle",
      "printer.notSharedBody",
      "printer.agentOfflineTitle",
      "printer.agentOfflineBody",
      "home.quickAgentsText",
      "home.quickPrintersText",
      "home.quickJobsText",
    ] as const;
    const enCatalog = en as unknown as Record<string, string>;
    const arCatalog = ar as unknown as Record<string, string>;
    for (const key of keys) {
      expect(enCatalog[key]?.length, `EN ${key}`).toBeGreaterThan(0);
      expect(arCatalog[key]?.length, `AR ${key}`).toBeGreaterThan(0);
      expect(arCatalog[key]).not.toBe(enCatalog[key]);
    }
  });
});

describe("WP8 printer-UX verification (code level)", () => {
  it("maps a not-shared printer to an honest, non-color-only unavailable state with a reason", () => {
    const result = printerPresentation(
      { sharedWithGateway: false, status: "online" },
      { status: "online", freshness: "fresh" },
    );
    expect(result.state).toBe("unavailable");
    expect(result.labelKey).toBe("printer.presentation.unavailable");
    expect(result.reasonKey).toBe("printer.presentation.notSharedReason");
  });

  it("maps a printer whose Agent is missing to the agent-unavailable reason, not a bare unknown", () => {
    const result = printerPresentation(
      { sharedWithGateway: true, status: "online" },
      null,
    );
    expect(result.state).toBe("unavailable");
    expect(result.reasonKey).toBe("printer.presentation.agentUnavailableReason");
  });

  it("wires the empty, not-shared and agent-offline states to actions in the dashboard client", () => {
    const client = read("src/app/dashboard/dashboard-client.tsx");
    // (c) picker path + (d) empty state: named Desktop path plus both
    // Gateway actions that actually exist (pair, go to Agents).
    expect(client).toContain("printer.emptyHowToFind");
    expect(client).toContain('href="/agents"');
    // (b) sharing state: reflected + explained + refreshable in details.
    expect(client).toContain("printer.notSharedTitle");
    expect(client).toContain("printer.notSharedBody");
    // (e) agent-offline state: banner above the agent list + details
    // callout, both with reconnect guidance and a refresh action.
    expect(client).toContain("printer.agentOfflineTitle");
    expect(client).toContain("printer.agentOfflineBody");
    expect(client).toContain("agentLiveView(agent, nowMs, locale).tone");
  });

  it("aligns Platform Admin on the same grouped-sidebar model", () => {
    const layout = read("src/app/platform/layout.tsx");
    expect(layout).toContain('sectionKey:"nav.section.operations"');
    expect(layout).toContain('sectionKey:"nav.section.administration"');
    expect(layout).toContain("<PlatformSidebar");
  });
});
