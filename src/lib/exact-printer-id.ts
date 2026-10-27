/**
 * Printer IDs are opaque execution identities, never display labels.
 * Neither a request, heartbeat, nor a private-sharing notification may trim
 * or otherwise coerce one ID into another printer's authority.
 *
 * The Gateway inventory and native Agent wire contract cap IDs at 120 UTF-8
 * bytes. Keep this dependency-free for both API validation and service calls.
 */
export function isExactPrinterId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value === value.trim()
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
    && new TextEncoder().encode(value).byteLength <= 120;
}
