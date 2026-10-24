# Cross-origin opener policy

Gateway responses use `Cross-Origin-Opener-Policy: same-origin`. The value is configured in both `next.config.ts` and the custom server's `src/server/api-defaults.ts`, including the ordinary HTTP rejection and parser-error serializers. The WebSocket path uses the same defaults for refusals, malformed upgrade responses and successful 101 upgrades through the installed `ws` hooks and explicit `wsClientError` serializer; upgrade headers do not themselves create a browser document.

The policy separates a Gateway document from an incompatible cross-origin opener's browsing context group. It limits retained window references; it does not claim complete cross-site leak prevention, a particular browser process arrangement or cross-origin isolation through COEP. No COEP policy is added. See the [HTML Standard's cross-origin opener policies](https://html.spec.whatwg.org/multipage/browsers.html#cross-origin-opener-policies).

The shipped Gateway does not use `window.open`, `window.opener` or `postMessage` for sign-in, password confirmation or billing. The certification timeline's new-tab anchor already uses `rel="noopener noreferrer"`. `BillingActions.tsx` and onboarding navigate the current tab to the provider URL using `window.location.href`; Stripe checkout and portal supply configured success, cancellation and return URLs. This follows the provider's [hosted checkout redirect flow](https://docs.stripe.com/payments/checkout/how-checkout-works). Adding a future popup-based provider flow requires a fresh policy and compatibility review.

## Verification and scope

`tests/server-http-boundary.test.ts` executes the actual custom-server HTTP wiring over TCP. It verifies the header on normal responses, redirects, method/origin/proxy/body/shutdown refusals and parser failures, and separately checks the Next response configuration. The pre-change run failed nine cases because the header was absent; the corrected twelve-case suite passes. `tests/ws-response-security-headers.test.ts` and the real PostgreSQL-backed WebSocket shutdown integration also cover the separate upgrade paths, including malformed library-level rejections.

`scripts/acceptance/coop-browser.mts` uses verified local Playwright and Chromium with the production header and CSP generators on two disposable loopback origins. Before the header change, the cross-origin opener remained accessible. Afterward, the browser verifies that the cross-origin opener is null, a compatible same-origin popup keeps its opener, and the same tab can navigate to the synthetic external checkout page and return with its synthetic HttpOnly cookie preserved.

```sh
YASEIR_PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
YASEIR_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome \
node --import tsx scripts/acceptance/coop-browser.mts
```

The browser control uses two origins on the same loopback host. It establishes opener and navigation behavior for this policy; it is not a real Stripe transaction, a cross-site SameSite-cookie acceptance test, deployed TLS certification or a browser fleet compatibility matrix. The isolated acceptance browser uses `--no-sandbox`; that flag is not a deployment recommendation.
