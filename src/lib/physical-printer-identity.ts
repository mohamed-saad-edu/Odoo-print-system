import { createHash } from "node:crypto";

/** Match configured logical execution endpoints within a single Agent and workspace.
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
  if (conn === "network" && !["ipp", "ipps"].includes(p.protocol.toLowerCase())) {
    const name = host(val(cfg.ip));
    if (name && port(cfg.port) !== null) endpoint = `net:${name}:${port(cfg.port)}`;
  } else if (conn === "ipp" || conn === "ipps" || conn === "network") {
    try {
      const ip = host(val(cfg.ip));
      const raw = conn === "network" ? `http://${ip.includes(":") ? `[${ip}]` : ip}:${cfg.port}/ipp/print` : val(cfg.address);
      const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
      if (["ipp:", "ipps:", "http:", "https:"].includes(url.protocol) && url.hostname && !url.username && !url.password && !url.search && !url.hash) {
        const scheme = url.protocol === "ipp:" ? "http:" : url.protocol === "ipps:" ? "https:" : url.protocol;
        const defaultPort = ["ipp:", "ipps:"].includes(url.protocol) ? "631" : scheme === "https:" ? "443" : "80";
        const path = (!url.pathname || url.pathname === "/" ? "/ipp/print" : url.pathname).replace(/%[0-9a-fA-F]{2}/g, escape => {
          const character = String.fromCharCode(parseInt(escape.slice(1), 16));
          return /^[A-Za-z0-9._~-]$/.test(character) ? character : escape.toUpperCase();
        });
        endpoint = `ipp:${scheme}:${host(url.hostname)}:${url.port || defaultPort}:${path}`;
      }
    } catch { /* Missing or invalid URI: cannot safely deduplicate. */ }
  } else if (conn === "spooler") {
    const queue = val(cfg.spooler_name) || val(cfg.address);
    if (queue) endpoint = `spooler:${queue.normalize("NFC").toLowerCase()}`;
  } else if (conn === "usb") {
    const serial = val(cfg.serial).toLowerCase();
    const vid = typeof cfg.vid === "number" && Number.isInteger(cfg.vid) && cfg.vid >= 0 && cfg.vid <= 65535 ? cfg.vid : null;
    const pid = typeof cfg.pid === "number" && Number.isInteger(cfg.pid) && cfg.pid >= 0 && cfg.pid <= 65535 ? cfg.pid : null;
    const address = val(cfg.address).toLowerCase();
    // USB interfaces sharing one device serial are distinct execution queues.
    if (address) endpoint = `usb-path:${address.normalize("NFC")}`;
    else if (serial && vid !== null && pid !== null) endpoint = `usb:${vid}:${pid}:${serial}`;
  }
  if (conn === "pdf_output" && typeof cfg.output_profile_id === "string" && cfg.output_profile_id === cfg.output_profile_id.trim() && /^[A-Za-z0-9_-]{1,64}$/.test(cfg.output_profile_id)) endpoint = `pdf-output:${cfg.output_profile_id}`;
  return endpoint ? "v2:" + createHash("sha256").update(endpoint, "utf8").digest("hex") : null;
}
export function matchingPhysicalPrinter<T extends PrinterEndpoint & { id: string; physicalIdentityKey?: string | null }>(
  rows: readonly T[], incoming: PrinterEndpoint, excludeId?: string,
): T | undefined {
  const key = physicalPrinterIdentityKey(incoming);
  return key ? rows.find(r => r.id !== excludeId && (physicalPrinterIdentityKey(r) ?? r.physicalIdentityKey) === key) : undefined;
}
export function samePrinterProtocol(a: PrinterEndpoint, b: PrinterEndpoint): boolean {
  const norm = (p: string) => p.toLowerCase() === "windows_spooler" ? "spooler" : p.toLowerCase();
  return norm(a.protocol) === norm(b.protocol);
}
