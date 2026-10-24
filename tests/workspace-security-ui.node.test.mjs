/** Real component/observer code with deterministic React and network boundaries.
 * Trusted events are explicit boundary fixtures; live browser acceptance is separate.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
// Password confirmation is shared by customer and manager accounts.
const status = { kind: "customer", reauthenticationRequired: true, stepUpExpiresAt: null, idleExpiresAt: "2030-01-01T00:30:00.000Z", absoluteExpiresAt: "2030-01-01T08:00:00.000Z" };
const confirmed = { ok: true, kind: status.kind, expiresAt: "2030-01-01T00:15:00.000Z", stepUpExpiresAt: "2030-01-01T00:05:00.000Z", idleExpiresAt: status.idleExpiresAt, absoluteExpiresAt: status.absoluteExpiresAt };
const reply = (code, body) => ({ ok: code >= 200 && code < 300, status: code, json: async () => body });

class Target {
  listeners = new Map();
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatchEvent(event) { for (const callback of this.listeners.get(event.type) ?? []) callback(event); return true; }
  size() { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0); }
}

function compile(file, imports, globals = {}) {
  const source = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const entry = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), source)(imports, entry, entry.exports, ...Object.values(globals));
  return entry.exports;
}

function harness(fetch, options = {}) {
  const states = [], refs = [], effects = [], memos = [], pending = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0, memoIndex = 0;
  const document = new Target(); document.visibilityState = "visible";
  const window = new Target();
  window.location = new URL(options.url ?? "https://gateway.test/settings?reauth=1&returnTo=%2Fapi-keys");
  Object.defineProperties(window, {
    localStorage: { get() { assert.fail("credentials must not use localStorage"); } },
    sessionStorage: { get() { assert.fail("credentials must not use sessionStorage"); } },
  });
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(value) { const i = stateIndex++; if (!(i in states)) states[i] = typeof value === "function" ? value() : value; return [states[i], next => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
    useRef(value) { const i = refIndex++; return refs[i] ??= { current: value }; },
    useCallback(fn, deps) { const i = memoIndex++; if (!memos[i] || !same(memos[i].deps, deps)) memos[i] = { fn, deps }; return memos[i].fn; },
    useEffect(fn, deps) { const i = effectIndex++; if (!effects[i] || !same(effects[i].deps, deps)) pending.push({ i, fn, deps }); },
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const errorKeys = compile("src/lib/api-error-keys.ts", name => { throw Error(name); });
  const imports = name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
    if (name === "next/link") return "Link";
    if (name === "next/navigation") return { useRouter: () => ({ replace() {}, refresh() {} }) };
    if (name.endsWith("/i18n/react")) return { useI18n: () => ({ t: key => key, formatDateTime: value => "formatted:" + value }) };
    if (name.endsWith("/fetch-timeout")) return { fetchWithTimeout: fetch, WORKSPACE_REAUTHENTICATION_EVENT: "yaseir:workspace-reauthentication-required" };
    if (name.endsWith("/api-error-keys")) return errorKeys;
    if (name === "./ui" || name === "lucide-react") return new Proxy({}, { get: (_target, key) => String(key) });
    throw Error("Unexpected workspace UI dependency " + name);
  };
  const entry = compile("src/components/WorkspaceSecurity.tsx", imports, { window, document, AbortController, Event, URL, URLSearchParams });
  return {
    exports: entry, window, document, states, tree: null,
    render(name = options.component ?? "WorkspaceSecurity") { stateIndex = refIndex = effectIndex = memoIndex = 0; this.tree = entry[name](); return this.tree; },
    effects() { while (pending.length) { const next = pending.shift(); effects[next.i]?.cleanup?.(); effects[next.i] = { deps: next.deps, fn: next.fn, cleanup: next.fn() }; } },
    replayEffects() { for (const effect of effects) { effect.cleanup?.(); effect.cleanup = effect.fn(); } },
    cleanup() { for (const effect of effects) effect?.cleanup?.(); },
  };
}

function find(tree, predicate) {
  if (Array.isArray(tree)) return tree.map(value => find(value, predicate)).find(Boolean);
  if (!tree || typeof tree !== "object") return undefined;
  return predicate(tree) ? tree : Object.values(tree.props ?? {}).map(value => find(value, predicate)).find(Boolean);
}
const input = h => find(h.tree, node => node.props?.id === "workspace-confirm-password");
const form = h => find(h.tree, node => node.type === "form");
async function mount(fetch, options) { const h = harness(fetch, options); h.render(); h.effects(); await flush(); h.render(); return h; }
function type(h, password) { input(h).props.onChange({ target: { value: password } }); h.render(); }
const submit = h => form(h).props.onSubmit({ preventDefault() {} });
const treeText = h => JSON.stringify(h.tree);

test("confirmation sends the exact password once, clears it, and offers only an explicit return link", async () => {
  const pending = deferred(), calls = [];
  const h = await mount(async (url, init) => { calls.push({ url, init }); return url.endsWith("/status") ? reply(200, status) : pending.promise; });
  const password = "  exact كلمة مرور \t";
  type(h, password);
  const handler = form(h).props.onSubmit;
  const first = handler({ preventDefault() {} }); const second = handler({ preventDefault() {} });
  await flush(); h.render();
  assert.equal(calls.filter(call => call.url.endsWith("/password")).length, 1);
  const request = calls.at(-1);
  assert.equal(JSON.parse(request.init.body).password, password);
  assert.equal(request.init.method, "POST");
  assert.equal(input(h).props.value, "");
  pending.resolve(reply(200, confirmed)); await Promise.all([first, second]); h.render();
  assert.equal(input(h).props.value, "");
  assert.match(treeText(h), /workspaceSecurity\.confirmed/);
  assert.equal(find(h.tree, node => node.type === "Link" && node.props.children === "workspaceSecurity.returnToTask").props.href, "/api-keys");
  assert.equal(calls.length, 2, "confirmation cannot replay the original task");
  h.cleanup();
});

test("the exact 4096-character limit is accepted and an oversized value is cleared without a request", async () => {
  const calls = [];
  const h = await mount(async (url, init) => { calls.push({ url, init }); return reply(200, url.endsWith("/status") ? status : confirmed); });
  assert.equal(input(h).props.maxLength, 4096);
  const boundary = " " + "x".repeat(4094) + " "; type(h, boundary); await submit(h); h.render();
  assert.equal(JSON.parse(calls.at(-1).init.body).password, boundary);
  type(h, "x".repeat(4097)); const before = calls.length; await submit(h); h.render();
  assert.equal(calls.length, before); assert.equal(input(h).props.value, "");
  assert.match(treeText(h), /workspaceSecurity\.passwordLength/); h.cleanup();
});

for (const [code, body, expected, expired] of [
  [403, { code: "PASSWORD_CONFIRMATION_FAILED" }, "workspaceSecurity.passwordIncorrect", false],
  [401, { code: "SESSION_EXPIRED" }, "errors.sessionExpired", true],
  [429, {}, "errors.tooManyAttempts", false],
  [503, {}, "errors.serviceUnavailable", false],
]) test(`confirmation ${code} clears the password and preserves its distinct translated outcome`, async () => {
  const h = await mount(async url => url.endsWith("/status") ? reply(200, status) : reply(code, body));
  type(h, "exact password"); await submit(h); h.render();
  assert.equal(input(h).props.value, ""); assert.ok(treeText(h).includes(expected));
  assert.equal(Boolean(find(h.tree, node => node.type === "Link" && node.props.children === "workspaceSecurity.signIn")), expired); h.cleanup();
});

test("transport failure is not reported as session expiry and never schedules a retry", async () => {
  let calls = 0;
  const h = await mount(async url => { calls++; if (url.endsWith("/status")) return reply(200, status); throw new TypeError("offline"); });
  type(h, "password"); await submit(h); h.render();
  assert.equal(input(h).props.value, ""); assert.match(treeText(h), /workspaceSecurity\.networkUnavailable/);
  assert.equal(find(h.tree, node => node.props?.children === "workspaceSecurity.signIn"), undefined);
  await flush(); assert.equal(calls, 2); h.cleanup();
});

test("unmount aborts a pending confirmation and its late success cannot notify or change UI state", async () => {
  const pending = deferred(); let request; const events = [];
  const h = await mount(async (url, init) => { if (url.endsWith("/status")) return reply(200, status); request = init; return pending.promise; });
  h.window.addEventListener("yaseir:workspace-reauthenticated", event => events.push(event));
  type(h, "password"); const flight = submit(h); await flush(); h.cleanup();
  assert.equal(request.signal.aborted, true); const before = JSON.stringify(h.states);
  pending.resolve(reply(200, confirmed)); await flight;
  assert.deepEqual(events, []); assert.equal(JSON.stringify(h.states), before);
});

test("status expiry values use the existing locale formatter and status401 is not a network error", async () => {
  const h = await mount(async () => reply(200, status));
  assert.ok(treeText(h).includes("formatted:" + status.idleExpiresAt)); assert.ok(treeText(h).includes("formatted:" + status.absoluteExpiresAt)); h.cleanup();
  const denied = await mount(async () => reply(401, { code: "SESSION_EXPIRED" }));
  assert.match(treeText(denied), /errors\.sessionExpired/); assert.equal(input(denied).props.disabled, true); denied.cleanup();
});

test("return paths reject external, API, auth, malformed and encoded separator targets", () => {
  const h = harness(async () => reply(200, status)); const safe = h.exports.safeWorkspaceReturnPath;
  for (const path of ["/dashboard#printers", "/api-keys?tab=active", "https://gateway.test/team", "/billing"]) assert.ok(safe(path, "https://gateway.test"));
  for (const path of [null, "", "//external.test", "https://external.test/dashboard", "javascript:alert(1)", "/api/auth/logout", "/login", "/platform/security", "https://user:password@gateway.test/dashboard", "/dashboard%2f..%2fapi/auth/logout", "/dashboard\\evil", "/dashboard\n", " /dashboard", "/dashboard/%ZZ", "/dashboard/../../api/auth/logout"]) assert.equal(safe(path, "https://gateway.test"), null, String(path));
});

test("workspace notice does not call activity on mount and never replays the request it announces", async () => {
  const calls = [];
  const h = await mount(async (url, init) => { calls.push({ url, init }); return reply(204); }, { component: "WorkspaceSecurityNotice", url: "https://gateway.test/team?view=members" });
  assert.equal(calls.length, 0); assert.equal(h.tree, null);
  h.window.dispatchEvent(new Event("yaseir:workspace-reauthentication-required")); h.render("WorkspaceSecurityNotice");
  const action = find(h.tree, node => node.type === "Link");
  assert.equal(action.props.href, "/settings?reauth=1&returnTo=%2Fteam%3Fview%3Dmembers#workspace-security");
  assert.equal(calls.length, 0);
  h.window.dispatchEvent(new Event("yaseir:workspace-reauthenticated")); h.render("WorkspaceSecurityNotice");
  assert.equal(h.tree, null); assert.equal(calls.length, 0); h.cleanup(); assert.equal(h.document.size(), 0);
});

test("activity requires trusted visible input, throttles60s, serializes requests and sends no input data", async () => {
  const calls = [], first = deferred(); let clock = 1000, expired = 0;
  const h = harness(async (url, init) => { calls.push({ url, init }); return calls.length === 1 ? first.promise : reply(204); });
  const stop = h.exports.observeWorkspaceActivity(h.document, () => { expired++; }, () => clock);
  assert.equal(calls.length, 0); assert.deepEqual([...h.document.listeners.keys()].sort(), ["keydown", "pointerdown", "touchstart", "wheel"]);
  h.document.dispatchEvent({ type: "pointerdown", isTrusted: false });
  h.document.visibilityState = "hidden"; h.document.dispatchEvent({ type: "keydown", isTrusted: true });
  h.document.dispatchEvent({ type: "focus", isTrusted: true }); h.document.dispatchEvent({ type: "visibilitychange", isTrusted: true });
  assert.equal(calls.length, 0); h.document.visibilityState = "visible";
  h.document.dispatchEvent({ type: "keydown", isTrusted: true, get key() { assert.fail("never inspect keys"); }, get target() { assert.fail("never inspect form data"); } });
  await flush(); assert.equal(calls.length, 1); assert.equal(calls[0].url, "/api/auth/activity"); assert.equal(calls[0].init.method, "POST"); assert.equal(calls[0].init.body, undefined);
  clock += 70000; h.document.dispatchEvent({ type: "wheel", isTrusted: true }); await flush(); assert.equal(calls.length, 1, "only one request in flight");
  first.resolve(reply(204)); await flush(); h.document.dispatchEvent({ type: "touchstart", isTrusted: true }); await flush(); assert.equal(calls.length, 2);
  clock += 59999; h.document.dispatchEvent({ type: "pointerdown", isTrusted: true }); await flush(); assert.equal(calls.length, 2);
  clock++; h.document.dispatchEvent({ type: "pointerdown", isTrusted: true }); await flush(); assert.equal(calls.length, 3); assert.equal(expired, 0); stop(); assert.equal(h.document.size(), 0);
});

test("activity401 is definite expiry while network/503 failures never sign out or auto-retry", async () => {
  for (const outcome of [401, 503, "network"]) {
    let count = 0, expired = 0, clock = 0;
    const h = harness(async () => { count++; if (outcome === "network") throw new TypeError("offline"); return reply(outcome); });
    const stop = h.exports.observeWorkspaceActivity(h.document, () => { expired++; }, () => clock);
    h.document.dispatchEvent({ type: "pointerdown", isTrusted: true }); await flush();
    assert.equal(expired, outcome === 401 ? 1 : 0); assert.equal(count, 1);
    clock = 60000; await flush(); assert.equal(count, 1, "elapsed time alone never sends activity");
    h.document.dispatchEvent({ type: "keydown", isTrusted: true }); await flush(); assert.equal(count, outcome === 401 ? 1 : 2); stop();
  }
});

test("activity cleanup aborts the pending request and ignores a late401", async () => {
  const pending = deferred(); let signal, expired = 0;
  const h = harness(async (_url, init) => { signal = init.signal; return pending.promise; });
  const stop = h.exports.observeWorkspaceActivity(h.document, () => { expired++; });
  h.document.dispatchEvent({ type: "pointerdown", isTrusted: true }); await flush(); stop();
  assert.equal(signal.aborted, true); assert.equal(h.document.size(), 0); pending.resolve(reply(401)); await flush(); assert.equal(expired, 0);
});

test("an explicit confirmation preserves the activity throttle while resuming the observer", async () => {
  let calls = 0;
  const h = await mount(async () => { calls++; return reply(204); }, { component: "WorkspaceSecurityNotice" });
  h.document.dispatchEvent({ type: "pointerdown", isTrusted: true }); await flush(); assert.equal(calls, 1);
  h.window.dispatchEvent(new Event("yaseir:workspace-reauthenticated"));
  h.document.dispatchEvent({ type: "keydown", isTrusted: true }); await flush();
  assert.equal(calls, 1, "reauthentication must not reset the 60-second activity budget"); h.cleanup();
});

test("effect replay starts a fresh status read and an obsolete401 cannot expire its replacement", async () => {
  const old = deferred(), current = deferred(); const calls = [];
  const h = harness(async (_url, init) => { calls.push(init); return calls.length === 1 ? old.promise : current.promise; });
  h.render(); h.effects(); await flush(); h.replayEffects(); await flush();
  assert.equal(calls.length, 2); assert.equal(calls[0].signal.aborted, true);
  old.resolve(reply(401, {})); await flush(); current.resolve(reply(200, status)); await flush(); h.render();
  assert.equal(input(h).props.disabled, false); assert.doesNotMatch(treeText(h), /errors\.sessionExpired/); h.cleanup();
});
