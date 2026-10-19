// @vitest-environment jsdom
import { act, createElement as h, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Dialog from "@radix-ui/react-dialog";
import { getNonce, setNonce } from "get-nonce";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CspStyleNonce } from "../src/components/CspStyleNonce";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let initialScript: HTMLScriptElement | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setNonce("");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  initialScript?.remove();
  setNonce("");
  root = undefined;
  host = undefined;
  initialScript = undefined;
  vi.unstubAllGlobals();
});

describe("CSP runtime style nonce", () => {
  it("uses the document CSP nonce rather than a later client-navigation nonce", () => {
    initialScript = document.createElement("script");
    initialScript.nonce = "initial-document-nonce";
    document.head.appendChild(initialScript);

    act(() => root!.render(h(CspStyleNonce, { nonce: "later-rsc-request-nonce" })));
    expect(getNonce()).toBe("initial-document-nonce");

    act(() => root!.render(h(CspStyleNonce, { nonce: "yet-another-rsc-nonce" })));
    expect(getNonce()).toBe("initial-document-nonce");
  });

  it("falls back to its server nonce when there is no existing nonce-bearing script", () => {
    act(() => root!.render(h(CspStyleNonce, { nonce: "server-nonce" })));
    expect(getNonce()).toBe("server-nonce");
  });

  it("gives Radix's dynamically injected modal style tags the active document nonce", () => {
    initialScript = document.createElement("script");
    initialScript.nonce = "modal-csp-nonce";
    document.head.appendChild(initialScript);

    act(() => root!.render(h(Fragment, null,
      h(CspStyleNonce, { nonce: "modal-csp-nonce" }),
      h(Dialog.Root, { open: true, children:
        h(Dialog.Portal, { children:
          h(Dialog.Content, { "aria-describedby": undefined, children:
            h(Dialog.Title, { children: "Navigation" }),
          }),
        }),
      }),
    )));

    const injected = [...document.head.querySelectorAll<HTMLStyleElement>("style")]
      .filter((tag) => tag.textContent?.includes("react-remove-scroll") || tag.textContent?.includes("overflow"));
    expect(injected.length).toBeGreaterThan(0);
    expect(injected.every((tag) => tag.nonce === "modal-csp-nonce")).toBe(true);
  });
});
