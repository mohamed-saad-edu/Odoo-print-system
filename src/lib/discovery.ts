import { z } from "zod";

// Canonical discovery taxonomy — discovery sources, NOT printer protocols.
// Printer's canonical protocol remains PRINTER_PROTOCOLS (raw/escpos/ipp/ipps/spooler).
export const DISCOVERY_SOURCES = ["mdns","ipp","ipps","raw","lpr","snmp","wsd","windows_spooler","usb","unknown","subnet","config","registry"] as const;
export type DiscoverySource = typeof DISCOVERY_SOURCES[number];
export const DISCOVERY_CANDIDATE_STATUS = ["discovered","verified","provisioned"] as const;
export const DISCOVERY_SESSION_STATUS = ["running","completed","partial","failed","cancelled"] as const;

export const discoveryStartSchema = z.object({
  timeoutMs: z.number().int().min(500).max(30000).optional(),
}).strict();

export function validateDiscoveryRequest(body: unknown): { ok: true; data: z.infer<typeof discoveryStartSchema> } | { ok: false; error: string } {
  const parsed = discoveryStartSchema.safeParse(body ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid discovery request" };
  return { ok: true, data: parsed.data };
}

export function confidenceFor(source: string[], verification: string, hasModel: boolean): string {
  const verified = verification === "verified";
  const count = source.length;
  const hasHigh = verified && (source.includes("ipp") || source.includes("ipps") || source.includes("windows_spooler"));
  if (hasHigh || (count >= 2 && hasModel)) return "high";
  if (verified || count >= 2 || hasModel) return "medium";
  return "low";
}
