/** Header notification must not alter the existing streaming fetch contract. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const source = readFileSync("src/lib/fetch-timeout.ts", "utf8");
const origin = "https://gateway.test";
async function helper(fetch, extra = {}) {
  const events = [];
  const context = vm.createContext({
    AbortController, AbortSignal, Error, Promise, Request, Response, URL, Event,
    fetch, window: { location: { origin, href: origin + "/dashboard" }, dispatchEvent: event => events.push(event) },
    ...extra,
  });
  const entry = new vm.SourceTextModule(stripTypeScriptTypes(source, { mode: "transform" }), { context });
  await entry.link(() => { throw new Error("fetch-timeout must remain dependency-free"); });
  await entry.evaluate();
  return { request: entry.namespace.fetchWithTimeout, events };
}

function response(url = origin + "/api/agents", status = 403, header = "required") {
  const result = new Response('{"code":"WORKSPACE_REAUTHENTICATION_REQUIRED"}', {
    status, headers: { "X-Yaseir-Reauthentication": header, "content-type": "application/json" },
  });
  Object.defineProperty(result, "url", { value: url });
  result.clone = () => assert.fail("notification must not clone the body");
  return result;
}

test("same-origin step-up response emits one body-free event and preserves the actual response", async () => {
  const expected = response();
  let calls = 0;
  const h = await helper(async () => { calls++; return expected; });
  const actual = await h.request("/api/agents", { method: "DELETE" });
  assert.equal(actual, expected);
  assert.equal(calls, 1, "never replay a mutation");
  assert.equal(actual.bodyUsed, false);
  assert.equal(h.events.length, 1);
  assert.equal(h.events[0].type, "yaseir:workspace-reauthentication-required");
  assert.equal(h.events[0].detail, undefined, "the event carries no request or response data");
  assert.deepEqual(await actual.json(), { code: "WORKSPACE_REAUTHENTICATION_REQUIRED" });
});

test("cross-origin input/redirects, missing response origin and unrelated failures never notify", async () => {
  for (const [input, url, status, header] of [
    ["https://external.test/api", origin + "/api/agents", 403, "required"],
    ["/api/agents", "https://external.test/api", 403, "required"],
    ["/api/agents", "", 403, "required"],
    ["/api/agents", origin + "/api/agents", 401, "required"],
    ["/api/agents", origin + "/api/agents", 403, "other"],
  ]) {
    const r = response(url, status, header);
    const h = await helper(async () => r);
    assert.equal(await h.request(input), r);
    assert.equal(h.events.length, 0);
    assert.equal(r.bodyUsed, false);
  }
});

test("same-origin URL and Request inputs notify without losing a Request-owned abort signal", async () => {
  for (const inputKind of ["url", "request"]) {
    const caller = new AbortController();
    let observed;
    const h = await helper(async (_input, init) => { observed = init.signal; return response(); });
    const url = origin + "/api/agents";
    const input = inputKind === "url" ? new URL(url) : new Request(url, { signal: caller.signal });
    await h.request(input, inputKind === "url" ? { signal: caller.signal } : {});
    assert.equal(h.events.length, 1);
    caller.abort();
    assert.equal(observed.aborted, true);
  }
});

test("notification does not cancel the deadline after headers or replace streaming reads", async () => {
  let signal;
  const native = response();
  const h = await helper(async (_input, init) => { signal = init.signal; return native; });
  const keepAlive = setTimeout(() => {}, 150);
  try {
    const r = await h.request("/api/agents", {}, 35);
    assert.equal(r, native);
    await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
    assert.equal(signal.aborted, true);
    assert.equal(r.bodyUsed, false);
  } finally { clearTimeout(keepAlive); }
});

test("nonbrowser execution and unavailable notification APIs preserve the response", async () => {
  const expected = response();
  for (const window of [undefined, { location: { origin, href: origin + "/dashboard" }, dispatchEvent() { throw new Error("unavailable"); } }]) {
    const h = await helper(async () => expected, { window });
    assert.equal(await h.request("/api/agents"), expected);
  }
});

test("opaque origins are not trusted merely because both stringify as null", async () => {
  const events = [];
  const expected = response("file:///api/agents");
  const h = await helper(async () => expected, { window: {
    location: { origin: "null", href: "file:///workspace/index.html" },
    dispatchEvent: event => events.push(event),
  } });
  assert.equal(await h.request("file:///api/agents"), expected);
  assert.equal(events.length, 0);
});
