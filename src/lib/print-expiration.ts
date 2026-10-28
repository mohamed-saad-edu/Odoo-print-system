import { z } from "zod";

// One wire contract for both Odoo submission endpoints. An omitted deadline
// uses the Gateway's database-clock default; an explicitly supplied malformed
// deadline must never be interpreted as omitted and silently extended.
const expiresAtIso = z.iso.datetime({ offset: true }).max(100);

export function parsePrintExpiration(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  if (!expiresAtIso.safeParse(value).success) {
    throw new Error("expiresAt must be a valid ISO-8601 timestamp with timezone");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("expiresAt must be a valid ISO-8601 timestamp with timezone");
  }
  // How far into the future this may be is checked under the authoritative
  // PostgreSQL clock in createPrintJobForPrinter, not using the app host clock.
  return date;
}
