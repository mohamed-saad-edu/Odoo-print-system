import { createHash } from "node:crypto";

/** Match verified transport endpoints within a single Agent and workspace.
 * Neither mutable display names nor discovered IDs are physical identity.
 * Print-language compatibility must be checked separately before reuse. */
export type PrinterEndpoint = {
  connectionType: string;
  protocol: string;
  config: Record<string, unknown> | null | undefined;
};
const val = (v: unknown) => typeof v === "string" ? v.trim() : "";
const host = (v: string) => v.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
const port = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 65535 ? v : null;
export function physicalPrinterIdentityKey(p: PrinterEndpoint): string | null {
  const cfg = p.config ?? {};
  const conn = p.connectionType.toLowerCase();
  let endpoint = "";
  if (conn === "network") {
    const name = host(val(cfg.ip));
    if (name && port(cfg.port) !== null) endpoint = `net:${name}:${port(cfg.port)}`;
  } else if (conn === "ipp" || conn === "ipps") {
    try {
      const url = new URL(val(cfg.address));
      if (url.protocol === conn + ":" && url.hostname) {
        endpoint = `ipp:${conn}:${host(url.hostname)}:${url.port || (conn === "ipps" ? "443" : "631")}:${url.pathname || "/"}${url.search}`;
      }
    } catch { /* Missing or invalid URI: cannot safely deduplicate. */ }
  } else if (conn === "spooler") {
    const queue = val(cfg.spooler_name) || val(cfg.address);
    if (queue) endpoint = `spooler:${queue.replace(/\s+/g, " ").toLowerCase()}`;
  } else if (conn === "usb") {
    const serial = val(cfg.serial).toLowerCase();
    const vid = typeof cfg.vid === "number" && Number.isInteger(cfg.vid) && cfg.vid >= 0 && cfg.vid <= 65535 ? cfg.vid : null;
    const pid = typeof cfg.pid === "number" && Number.isInteger(cfg.pid) && cfg.pid >= 0 && cfg.pid <= 65535 ? cfg.pid : null;
    const address = val(cfg.address).toLowerCase();
    if (serial && vid !== null && pid !== null) endpoint = `usb:${vid}:${pid}:${serial}`;
    else if (address) endpoint = `usb-path:${address}`;
  }
  return endpoint ? "v1:" + createHash("sha256").update(endpoint, "utf8").digest("hex") : null;
}
export function matchingPhysicalPrinter<T extends PrinterEndpoint & { id: string; physicalIdentityKey?: string | null }>(
  rows: readonly T[], incoming: PrinterEndpoint, excludeId?: string,
): T | undefined {
  const key = physicalPrinterIdentityKey(incoming);
  return key ? rows.find(r => r.id !== excludeId && (r.physicalIdentityKey ?? physicalPrinterIdentityKey(r)) === key) : undefined;
}
export function samePrinterProtocol(a: PrinterEndpoint, b: PrinterEndpoint): boolean {
  const norm = (p: string) => p.toLowerCase() === "windows_spooler" ? "spooler" : p.toLowerCase();
  return norm(a.protocol) === norm(b.protocol);
}
