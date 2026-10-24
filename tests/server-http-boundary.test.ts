import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { connect, type AddressInfo } from "node:net";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as apiDefaults from "../src/server/api-defaults";
import * as requestGuard from "../src/server/request-guard";
import * as csp from "../src/server/content-security-policy";
import * as cors from "../src/server/cors";
import nextConfig from "../next.config";

// Execute the actual server.ts HTTP wiring against real TCP clients. The
// application handler is the only stand-in: reaching it records admission,
// so a rejected method/body cannot pass merely because Next rejects it later.
const source = readFileSync("server.ts", "utf8");
const start = source.indexOf("  const server = createServer(");
const end = source.indexOf("\n  httpServer = server;", start);
if (start < 0 || end <= start) throw new Error("Cannot locate actual HTTP server boundary");
const boundary = stripTypeScriptTypes(source.slice(start, end));
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  requestGuard.flushAuthorizationDenials();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function harness(production = true) {
  vi.stubEnv("NODE_ENV", production ? "production" : "development");
  vi.stubEnv("APP_BASE_URL", "https://gateway.example.test");
  const admitted: string[] = [];
  const context = vm.createContext({
    ...apiDefaults, ...requestGuard, ...csp, ...cors, createServer,
    shuttingDown: false, logError: vi.fn(),
    trustProxyEnabled: () => true,
    isTrustedProxyRequest: (req: IncomingMessage) => req.headers["x-fixture-proxy"] === "trusted",
    handle: async (req: IncomingMessage, res: ServerResponse) => {
      admitted.push(`${req.method} ${req.url}`);
      for await (const _chunk of req) { /* normal handler consumes an admitted body */ }
      if (req.url?.startsWith("/api/denial-fixture/")) {
        res.statusCode = req.url.includes("unauthenticated") ? 401 : 403;
        res.end(JSON.stringify({ error: "Fixture access refused" }));
      } else if (req.url === "/canonical/") {
        res.writeHead(308, { location: "/canonical" });
        res.end();
      } else {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ method: req.method }));
      }
    },
  });
  vm.runInContext(`${boundary}\nglobalThis.server = server;`, context);
  const server = context.server as Server;
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  function send(method: string, path: string, body = "", headers: Record<string, string> = {}) {
    return new Promise<{ status: number; headers: IncomingMessage["headers"]; body: string }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, method, path,
        headers: { "x-fixture-proxy": "trusted", "content-length": String(Buffer.byteLength(body)), ...headers },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("error", reject);
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.setTimeout(8_000, () => req.destroy(new Error("fixture HTTP timeout")));
      req.on("error", reject);
      req.end(body);
    });
  }
  function raw(text: string) {
    return new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => socket.write(text));
      const chunks: Buffer[] = [];
      socket.setTimeout(8_000, () => socket.destroy(new Error("fixture raw HTTP timeout")));
      socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      socket.on("error", reject);
      socket.on("end", () => {
        const response = Buffer.concat(chunks).toString("utf8");
        const [head, ...body] = response.split("\r\n\r\n");
        const [statusLine, ...lines] = head.split("\r\n");
        resolve({ status: Number(statusLine.split(" ")[1]), headers: Object.fromEntries(lines.map((line) => {
          const split = line.indexOf(":");
          return [line.slice(0, split).toLowerCase(), line.slice(split + 1).trim()];
        })), body: body.join("\r\n\r\n") });
      });
    });
  }
  return { context, admitted, send, raw };
}

function expectSecurityHeaders(headers: IncomingMessage["headers"]) {
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=()");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
}

describe("actual custom server HTTP boundary", () => {
  it("records early Origin and application authorization refusals without request secrets", async () => {
    const output = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = await harness();
    const forbidden = await run.send("POST", "/api/denial-fixture/forbidden?token=query-proof", "body-private", {
      authorization: "Bearer header-private", cookie: "ordinary=cookie-private", "x-request-id": "private-correlation-proof",
    });
    const unauthenticated = await run.send("GET", "/api/denial-fixture/unauthenticated");
    const origin = await run.send("POST", "/api/auth/login?token=origin-query-proof", "password-private", {
      host: "gateway.example.test", cookie: "__Host-cust_session=session-private", origin: "https://elsewhere.example.test",
    });
    expect([forbidden.status, unauthenticated.status, origin.status]).toEqual([403, 401, 403]);
    const rows = output.mock.calls.map(([line]) => JSON.parse(String(line)))
      .filter(row => row.event === "security.access.denied" && row.surface === "http");
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.status)).toEqual([403, 401, 403]);
    expect(rows.every(row => row.count === 1)).toBe(true);
    const serialized = JSON.stringify(rows);
    for (const secret of ["query-proof", "header-private", "cookie-private", "body-private", "password-private", "session-private", "private-correlation-proof"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(requestGuard.getReservedRequestBytes()).toBe(0);
  });

  it("also applies same-origin opener isolation through Next's response configuration", async () => {
    const policies = await nextConfig.headers!();
    expect(policies.find(policy => policy.source === "/(.*)")?.headers)
      .toContainEqual({ key: "Cross-Origin-Opener-Policy", value: "same-origin" });
  });

  it.each([["TRACE", "/"], ["TRACE", "/api/health"], ["TRACE", "/api/metrics"], ["PROPFIND", "/api/agent/jobs"]])(
    "rejects unsupported %s %s before application handling and drains the abandoned body", async (method, path) => {
      const run = await harness();
      const response = await run.send(method, path, "private-synthetic-request-body", { "x-sensitive-probe": "private-synthetic-header" });
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
      expect(response.headers.connection).toBe("close");
      expect(response.body).toContain("METHOD_NOT_ALLOWED");
      expect(response.body).not.toContain("private-synthetic");
      expectSecurityHeaders(response.headers);
      expect(run.admitted).toEqual([]);
      expect(requestGuard.getReservedRequestBytes()).toBe(0);
    },
  );

  it("preserves every supported application method", async () => {
    const run = await harness();
    for (const method of ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
      const response = await run.send(method, "/allowed", method === "POST" ? "{}" : "");
      expect(response.status).toBe(200);
      expect(run.admitted.at(-1)).toBe(`${method} /allowed`);
    }
  });

  it("rejects CSP telemetry over its 16 KiB admission ceiling before application handling", async () => {
    const run = await harness();
    const response = await run.send("POST", "/api/security/csp-report", "x".repeat(16 * 1024 + 1));
    expect(response.status).toBe(413);
    expect(response.body).toContain("REQUEST_BODY_TOO_LARGE");
    expect(run.admitted).toEqual([]);
  });

  it("keeps security defaults on proxy, origin, body and shutdown rejections", async () => {
    const run = await harness();
    const proxy = await run.send("GET", "/api/metrics", "", { "x-fixture-proxy": "untrusted" });
    const origin = await run.send("POST", "/api/auth/login", "{}", {
      host: "gateway.example.test", cookie: "__Host-cust_session=synthetic-invalid-cookie", origin: "https://elsewhere.example.test",
    });
    const body = await run.send("POST", "/api/agent/register", "x".repeat(65 * 1024));
    run.context.shuttingDown = true;
    const shutdown = await run.send("GET", "/api/live");
    for (const [response, status] of [[proxy, 400], [origin, 403], [body, 413], [shutdown, 503]] as const) {
      expect(response.status).toBe(status);
      expectSecurityHeaders(response.headers);
      expect(response.headers["cache-control"]).toBe("no-store");
    }
    expect(run.admitted).toEqual([]);
  });

  it("keeps security defaults on canonical redirects and application responses", async () => {
    const run = await harness();
    for (const path of ["/canonical/", "/ordinary"]) {
      const response = await run.send("GET", path);
      expect(response.status).toBe(path.endsWith("/") ? 308 : 200);
      expectSecurityHeaders(response.headers);
      expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    }
  });

  it("does not force HSTS on development HTTP", async () => {
    const run = await harness(false);
    const response = await run.send("GET", "/ordinary");
    expect(response.headers["strict-transport-security"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it.each([{ header: "Content-Length: invalid\r\n", status: 400 }, { header: `X-Oversized: ${"x".repeat(20 * 1024)}\r\n`, status: 431 }])(
    "keeps a bounded, generic parser rejection with status $status", async ({ header, status }) => {
      const run = await harness();
      const response = await run.raw(`POST /api/agent/register HTTP/1.1\r\nHost: gateway.example.test\r\n${header}Connection: close\r\n\r\n`);
      expect(response.status).toBe(status);
      expectSecurityHeaders(response.headers);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers.connection).toBe("close");
      expect(response.body.length).toBeLessThan(200);
      expect(response.body).not.toContain("invalid");
      expect(run.admitted).toEqual([]);
    },
  );
});
