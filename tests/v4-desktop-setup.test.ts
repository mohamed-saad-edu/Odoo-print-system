import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../src/i18n/react";
import { SetupGuide } from "../src/desktop/components/SetupGuide";
import type { DesktopState } from "../src/desktop/types";

function guide(pairingConfirmed: boolean) {
  // A running service and healthy public Gateway endpoint are deliberately
  // present; neither is authenticated evidence that this computer is paired.
  const state = { gatewayConnected: true, isOnline: true, pairingConfirmed, printers: [], nowMs: Date.now(), pairCode: "", busy: false,
    navigate: () => {}, pair: () => {}, setPairCode: () => {}, handleDiscover: () => {} } as unknown as DesktopState;
  return renderToStaticMarkup(h(I18nProvider, { initialLocale: "en", children: h(SetupGuide, { s: state }) }));
}
describe("V4 guided desktop setup", () => {
  it("keeps the pairing action available until authenticated evidence confirms it", () => {
    expect(guide(false)).toContain('id="home-pair-code"');
    expect(guide(false)).toContain("A running service alone does not confirm pairing.");
  });
  it("advances to discovery after authenticated pairing without claiming a printer is ready", () => {
    const html = guide(true);
    expect(html).not.toContain('id="home-pair-code"');
    expect(html).toContain("Discover");
    expect(html).toContain("Not yet confirmed");
  });
});
