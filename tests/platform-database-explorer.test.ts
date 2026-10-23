import { describe, it, expect, vi } from "vitest";
import type { PoolClient } from "pg";

const db = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("../src/db", () => ({ pool: { connect: db.connect } }));
import { exploreRows, listExploreTables, readPlatformDatabase } from "../src/lib/platform-data-explorer";

const catalog = [
  { table_name: "printers", column_name: "id", data_type: "text", is_primary: true },
  { table_name: "printers", column_name: "name", data_type: "text", is_primary: false },
  { table_name: "printers", column_name: "secret_hash", data_type: "text", is_primary: false },
  { table_name: "printers", column_name: "payload", data_type: "jsonb", is_primary: false },
  { table_name: "refresh_tokens", column_name: "id", data_type: "text", is_primary: true },
];
const client = (query: ReturnType<typeof vi.fn>) =>
  ({ query, release: vi.fn() }) as unknown as PoolClient;

describe("read-only Platform Owner catalog and search", () => {
  it("reads one bounded catalog and strips secrets and auth tables", async () => {
    const query = vi.fn().mockResolvedValue({ rows: catalog });
    const result = await listExploreTables(client(query));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("LIMIT 250");
    expect(result).toEqual([{ name: "printers", columns: ["id", "name"], primaryKey: "id" }]);
  });

  it("binds literal punctuation and never interpolates search input", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: "A1", name: "Desk" }] });
    const term = `_%'";DROP TABLE printers;--`;
    await exploreRows(client(query), { name: "printers", columns: ["id", "name"], primaryKey: "id" }, term, 25, 25);
    const [statement, params] = query.mock.calls[0] as [string, unknown[]];
    expect(statement).toContain('FROM "printers"');
    expect(statement).toContain('strpos(lower("name"::text), lower($1)) > 0');
    expect(statement).not.toContain("DROP TABLE");
    expect(params).toEqual([term, 25, 25]);
  });

  it("reads within READ ONLY and rolls back safely on failures", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("information_schema.columns")) return { rows: catalog };
      if (sql.includes('FROM "printers"')) return { rows: [{ id: "A1", name: "Desk" }] };
      return { rows: [] };
    });
    const connected = client(query);
    db.connect.mockResolvedValueOnce(connected);
    const result = await readPlatformDatabase({ table: "printers", search: "desk" });
    expect(result.selected).toBe("printers");
    expect(result.rows).toHaveLength(1);
    const sql = query.mock.calls.map(([q]) => String(q));
    expect(sql[0]).toBe("BEGIN READ ONLY");
    expect(sql[1]).toContain("statement_timeout = '4000ms'");
    expect(sql.at(-1)).toBe("COMMIT");
    expect(connected.release).toHaveBeenCalledOnce();

    const failure = vi.fn().mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce({ rows: [] });
    const failed = client(failure);
    db.connect.mockResolvedValueOnce(failed);
    await expect(readPlatformDatabase({})).rejects.toThrow("database unavailable");
    expect(failure.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(failed.release).toHaveBeenCalledOnce();
  });
});
