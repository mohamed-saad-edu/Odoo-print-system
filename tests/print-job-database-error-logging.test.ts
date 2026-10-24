import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";
import type * as PrintJobService from "../src/lib/print-job-service";

const state = vi.hoisted(() => ({ create: vi.fn() }));

// Only the external authentication/database service boundary is replaced. The
// request parser, route catch clauses, Drizzle wrapper and JSON logger are real.
vi.mock("../src/lib/odoo-auth", () => ({
  validateOdooKey: vi.fn(async () => ({ id: "key_fixture", tenantId: "tenant_fixture", readOnly: false })),
}));
vi.mock("../src/db", () => ({ db: {} }));
vi.mock("../src/lib/print-job-service", async () => ({
  ...await vi.importActual<typeof PrintJobService>("../src/lib/print-job-service"),
  createPrintJobForPrinter: state.create,
}));

import { POST as legacyPOST } from "../src/app/api/print/jobs/route";
import { POST as v2POST } from "../src/app/api/print/jobs/v2/route";

const PRIVATE_QUERY = "SELECT SYNTHETIC_PRIVATE_SQL FROM example WHERE credential = $1 AND document = $2";
const PRIVATE_CREDENTIAL = "SYNTHETIC_PRIVATE_CREDENTIAL";
const PRIVATE_PAYLOAD = "SYNTHETIC_PRIVATE_RECEIPT";

function wrappedFailure(cause: unknown): DrizzleQueryError {
  return new DrizzleQueryError(PRIVATE_QUERY, [PRIVATE_CREDENTIAL, PRIVATE_PAYLOAD], cause as Error);
}

function request(): Request {
  return new Request("https://gateway.test/api/print/jobs", {
    method: "POST",
    headers: { "content-type": "application/json", "x-request-id": "request_fixture" },
    body: JSON.stringify({
      printerId: "printer_fixture", documentType: "receipt", idempotencyKey: "operation_fixture",
      payload: { type: "raw", protocol: "raw", encoding: "base64", data: "aGVsbG8K" },
    }),
  });
}

describe.each([["legacy", legacyPOST], ["v2", v2POST]] as const)("%s print failure logging", (_name, post) => {
  beforeEach(() => {
    state.create.mockReset();
    vi.stubEnv("LOG_LEVEL", "error");
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  async function rejectAndReadLog(error: unknown) {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.create.mockRejectedValueOnce(error);
    const response = await post(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error", code: "INTERNAL_ERROR", retryable: true });
    expect(state.create).toHaveBeenCalledTimes(1);
    const lines = output.mock.calls.map(([line]) => String(line));
    const events = lines.map(line => JSON.parse(line)).filter(row => row.event === "print.job.create_failed");
    expect(events).toHaveLength(1);
    return { event: events[0] as Record<string, unknown>, text: lines.join("\n") };
  }

  it("retains a nested database lock SQLSTATE while preserving the generic HTTP response", async () => {
    const cause = Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
    const { event } = await rejectAndReadLog(wrappedFailure(cause));
    expect(event).toMatchObject({
      operationIdentityProvided: true, errorCategory: "database_lock_not_available", sqlState: "55P03",
    });
  });

  it("omits SQL, parameters, payload, credentials and driver detail from the actual emitted event", async () => {
    const cause = Object.assign(new Error(PRIVATE_CREDENTIAL), {
      code: "55P03", detail: PRIVATE_PAYLOAD, query: PRIVATE_QUERY, params: [PRIVATE_CREDENTIAL],
      hint: PRIVATE_PAYLOAD, where: PRIVATE_CREDENTIAL, schema: PRIVATE_PAYLOAD, table: PRIVATE_PAYLOAD,
    });
    const { event, text } = await rejectAndReadLog(wrappedFailure(cause));
    for (const value of [PRIVATE_QUERY, PRIVATE_CREDENTIAL, PRIVATE_PAYLOAD]) expect(text).not.toContain(value);
    for (const key of ["error", "message", "query", "params", "payload", "cause", "stack", "detail", "hint", "where", "schema", "table"]) {
      expect(event).not.toHaveProperty(key);
    }
    expect(text.length).toBeLessThan(512);
  });

  it.each([
    ["57014", "database_query_canceled"],
    ["40P01", "database_deadlock"],
    ["40001", "database_serialization_failure"],
    ["08006", "database_connection_failure"],
    ["57P01", "database_admin_shutdown"],
  ])("distinguishes recognized database code %s without interpreting its message", async (code, category) => {
    const cause = Object.assign(new Error(PRIVATE_PAYLOAD), { code });
    const { event } = await rejectAndReadLog(wrappedFailure(cause));
    expect(event).toMatchObject({ errorCategory: category, sqlState: code });
  });

  it("finds the driver code through an additional ordinary Error cause wrapper", async () => {
    const driver = Object.assign(new Error(PRIVATE_PAYLOAD), { code: "55P03" });
    const { event } = await rejectAndReadLog(new Error(PRIVATE_CREDENTIAL, { cause: wrappedFailure(driver) }));
    expect(event).toMatchObject({ errorCategory: "database_lock_not_available", sqlState: "55P03" });
  });

  it("recognizes a direct driver error without requiring Drizzle", async () => {
    const { event } = await rejectAndReadLog(Object.assign(new Error(PRIVATE_PAYLOAD), { code: "55P03" }));
    expect(event).toMatchObject({ errorCategory: "database_lock_not_available", sqlState: "55P03" });
  });

  it.each(["55P03\nSYNTHETIC_PRIVATE_CREDENTIAL", "ZZZZZ", "__proto__", 55003, null])(
    "uses a fixed fallback for an unrecognized or malformed code %s", async code => {
      const { event, text } = await rejectAndReadLog(wrappedFailure({ code, message: PRIVATE_CREDENTIAL }));
      expect(event).toMatchObject({ errorCategory: "internal_error" });
      expect(event).not.toHaveProperty("sqlState");
      expect(text).not.toContain(PRIVATE_CREDENTIAL);
    },
  );

  it("never serializes a primitive thrown value", async () => {
    const { event, text } = await rejectAndReadLog(PRIVATE_CREDENTIAL);
    expect(event).toMatchObject({ errorCategory: "internal_error" });
    expect(event).not.toHaveProperty("sqlState");
    expect(text).not.toContain(PRIVATE_CREDENTIAL);
  });

  it("ignores an inherited code and inherited cause", async () => {
    const inherited = Object.create({ code: "55P03", cause: { code: "55P03" } });
    const { event } = await rejectAndReadLog(wrappedFailure(inherited));
    expect(event).toMatchObject({ errorCategory: "internal_error" });
    expect(event).not.toHaveProperty("sqlState");
  });

  it("does not execute code or cause accessors", async () => {
    let reads = 0;
    const cause = Object.defineProperties({}, {
      code: { get() { reads++; throw new Error(PRIVATE_CREDENTIAL); } },
      cause: { get() { reads++; throw new Error(PRIVATE_CREDENTIAL); } },
    });
    const { event } = await rejectAndReadLog(wrappedFailure(cause));
    expect(reads).toBe(0);
    expect(event).toMatchObject({ errorCategory: "internal_error" });
    expect(event).not.toHaveProperty("sqlState");
  });

  it("can follow an own data cause while ignoring an accessor code", async () => {
    let reads = 0;
    const cause = Object.defineProperty({ cause: { code: "55P03" } }, "code", {
      get() { reads++; throw new Error(PRIVATE_CREDENTIAL); },
    });
    const { event } = await rejectAndReadLog(wrappedFailure(cause));
    expect(reads).toBe(0);
    expect(event).toMatchObject({ errorCategory: "database_lock_not_available", sqlState: "55P03" });
  });

  it("falls back when a hostile proxy rejects property inspection", async () => {
    const cause = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(PRIVATE_CREDENTIAL); } });
    const { event, text } = await rejectAndReadLog(wrappedFailure(cause));
    expect(event).toMatchObject({ errorCategory: "internal_error" });
    expect(event).not.toHaveProperty("sqlState");
    expect(text).not.toContain(PRIVATE_CREDENTIAL);
  });

  it("terminates a cycle within a small property-inspection budget", async () => {
    let reads = 0;
    const target: { cause?: unknown } = {};
    const cycle = new Proxy(target, {
      getOwnPropertyDescriptor(object, key) {
        if (++reads > 20) throw new Error("inspection budget exceeded");
        return Object.getOwnPropertyDescriptor(object, key);
      },
    });
    target.cause = cycle;
    const { event } = await rejectAndReadLog(wrappedFailure(cycle));
    expect(reads).toBeLessThan(20);
    expect(event).toMatchObject({ errorCategory: "internal_error" });
    expect(event).not.toHaveProperty("sqlState");
  });

  it("stops traversing an excessively deep cause chain", async () => {
    let cause: unknown = { code: "55P03" };
    for (let i = 0; i < 1_000; i++) cause = { cause };
    const { event, text } = await rejectAndReadLog(wrappedFailure(cause));
    expect(event).toMatchObject({ errorCategory: "internal_error" });
    expect(event).not.toHaveProperty("sqlState");
    expect(text.length).toBeLessThan(512);
  });
});
