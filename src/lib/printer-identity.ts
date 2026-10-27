import { createHash } from "node:crypto";

/**
 * Gateway printer IDs are limited to 120 UTF-8 bytes across Agent control
 * surfaces. Preserve the 8-hex alias suffix even for long local IDs.
 * The Go Agent independently reconstructs this complete ID before accepting
 * an alias, so a forged/truncated prefix must not select another printer.
 */
export function aliasPrinterIdForAgent(localId: string, agentId: string): string {
  const suffix = createHash("sha256")
    .update(`printer-alias:${agentId}:${localId}`, "utf8")
    .digest("hex")
    .slice(0, 8);
  const MAX_PREFIX_BYTES = 120 - 1 - 8;
  let prefix = "";
  let bytes = 0;
  for (const codePoint of localId) {
    const next = Buffer.byteLength(codePoint, "utf8");
    if (bytes + next > MAX_PREFIX_BYTES) break;
    prefix += codePoint;
    bytes += next;
  }
  return `${prefix}~${suffix}`;
}
