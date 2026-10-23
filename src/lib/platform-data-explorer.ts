import { pool } from "../db";
import type { PoolClient } from "pg";

/** Metadata-driven, read-only database inventory. Database identifiers are
 * never supplied to SQL directly by the browser. All identifiers are quoted
 * only after checking them against pg_catalog.
 *
 * Sensitive columns (including credential hashes, tokens and raw print payload)
 * are excluded server-side, not masked after fetching. JSON/blob columns are
 * excluded because they may contain nested secrets or customer documents.
 */
const SECRET = /(?:password|secret|token|credential|private|signature|salt|hash|payload|document|certificate|authorization|cookie|session_data|card_number|payment_method|refresh|recovery|otp|passcode|api_key_value|body|content|address_line|phone|email)/i;
const SAFE_TYPES = new Set(["text","character varying","character","uuid","integer","bigint","smallint","numeric","boolean","timestamp without time zone","timestamp with time zone","date","double precision","real","USER-DEFINED"]);
const ALWAYS_HIDDEN = new Set(["platform_sessions","refresh_tokens","auth_rate_limits","password_reset_tokens","email_verification_tokens","pg_stat_statements"]);
export type ExploreTable = { name: string; columns: string[]; primaryKey: string | null };
const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';

export async function listExploreTables(client: PoolClient): Promise<ExploreTable[]> {
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
     ORDER BY table_name LIMIT 250`);
  const result: ExploreTable[] = [];
  for (const { table_name } of tables.rows) {
    if (ALWAYS_HIDDEN.has(table_name)) continue;
    const meta = await client.query<{ column_name: string; data_type: string; is_primary: boolean }>(
      `SELECT c.column_name,c.data_type,
         EXISTS (SELECT 1 FROM information_schema.table_constraints t
           JOIN information_schema.key_column_usage k
             ON k.constraint_name=t.constraint_name AND k.table_schema=t.table_schema AND k.table_name=t.table_name
           WHERE t.constraint_type='PRIMARY KEY' AND t.table_schema=c.table_schema
             AND t.table_name=c.table_name AND k.column_name=c.column_name) AS is_primary
       FROM information_schema.columns c
       WHERE c.table_schema = current_schema() AND c.table_name=$1
       ORDER BY c.ordinal_position`, [table_name]);
    const columns = meta.rows.filter(c=>SAFE_TYPES.has(c.data_type) && !SECRET.test(c.column_name)).map(c=>c.column_name).slice(0,40);
    if (!columns.length) continue;
    const primaryKey = meta.rows.find(c=>c.is_primary && columns.includes(c.column_name))?.column_name ?? (columns.includes("id") ? "id" : null);
    result.push({name:table_name, columns, primaryKey});
  }
  return result;
}
export async function exploreRows(client: PoolClient, table: ExploreTable, search: string, offset: number, limit: number) {
  const colSQL = table.columns.map(quote).join(", ");
  const idColumn = table.primaryKey;
  const where = search ? idColumn ? `WHERE ${quote(idColumn)}::text = $1` : "" : "";
  if (search && !idColumn) return [];
  const args = search ? [search,limit,offset] : [limit,offset];
  const index = search ? 2 : 1;
  const result = await client.query<Record<string,unknown>>(
    `SELECT ${colSQL} FROM ${quote(table.name)} ${where}
      ORDER BY ${quote(table.columns.includes("created_at") ? "created_at" : idColumn ?? table.columns[0])} DESC
      LIMIT $${index} OFFSET $${index + 1}`,args);
  return result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>[k,
     typeof v==="string" && v.length>320 ? v.slice(0,320)+"…" : v instanceof Date ? v.toISOString() : v])));
}
export async function readPlatformDatabase(input: { table?: string; search?: string; offset?: number }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '4000ms'");
    const tables = await listExploreTables(client);
    const table = input.table ? tables.find(t=>t.name === input.table) : null;
    const rows = table ? await exploreRows(client,table,input.search ?? "",input.offset ?? 0,25) : [];
    await client.query("COMMIT");
    return { tables, selected: table?.name ?? null, columns: table?.columns ?? [], rows,
      hasMore:rows.length===25 };
  } catch(e) { await client.query("ROLLBACK").catch(()=>{});throw e; }
  finally { client.release(); }
}
