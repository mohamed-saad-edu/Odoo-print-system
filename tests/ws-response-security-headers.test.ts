import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as defaults from "../src/server/api-defaults";
import { recordAuthorizationDenial, flushAuthorizationDenials } from "../src/server/authorization-monitor";

const source = readFileSync("src/server/ws.ts", "utf8");
const start = source.indexOf("function writeWsHttpError(");
const end = source.indexOf("\nfunction logUpgradeError(", start);
if (start < 0 || end <= start) throw new Error("Cannot locate actual WebSocket refusal serializer");
const serializer = stripTypeScriptTypes(source.slice(start, end));
afterEach(() => { flushAuthorizationDenials(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("actual WebSocket refusal HTTP serializer", () => {
  it.each([400, 401, 403, 404, 429, 500, 503])("preserves refusal %i and includes the common production security headers", (status) => {
    vi.stubEnv("NODE_ENV", "production");
    const output = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let wire = "";
    const socket = { end: (value: string) => { wire = value; }, destroy: vi.fn() };
    const context = vm.createContext({ ...defaults, Buffer, logDebug: vi.fn(), recordAuthorizationDenial });
    vm.runInContext(`${serializer}\nglobalThis.refuse = writeWsHttpError;`, context);
    const retry = status === 429 || status === 503 ? 5 : undefined;
    context.refuse(socket, status, "Synthetic refusal", retry);
    const [head, body] = wire.split("\r\n\r\n");
    const [statusLine, ...lines] = head.split("\r\n");
    const headers = Object.fromEntries(lines.map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
    }));
    expect(Number(statusLine.split(" ")[1])).toBe(status);
    expect(JSON.parse(body)).toEqual({ error: "Synthetic refusal" });
    expect(headers["content-length"]).toBe(String(Buffer.byteLength(body)));
    expect(headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(headers.connection).toBe("close");
    expect(headers["retry-after"]).toBe(retry === undefined ? undefined : "5");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=()");
    expect(headers["cache-control"]).toBe("no-store");
    expect(socket.destroy).not.toHaveBeenCalled();
    const events = output.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(events).toHaveLength([400, 401, 403, 429].includes(status) ? 1 : 0);
    if (events.length) expect(events[0]).toMatchObject({ event: "security.access.denied", surface: "websocket", status, count: 1 });
    expect(JSON.stringify(events)).not.toContain("Synthetic refusal");
  });
});
