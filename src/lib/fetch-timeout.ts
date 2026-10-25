/** Bounded browser fetch across headers AND streaming response consumption.
 *
 * The fetch() promise resolves once response HEADERS arrive. Cleaning up a
 * setTimeout() in its finally block therefore silently cancels the deadline
 * before response.json()/text()/blob() have read the body. Native AbortSignal
 * composition remains active for the complete response stream, including
 * cloned responses, without wrapping or buffering any Response body.
 *
 * Note: after headers, the browser may surface AbortError rather than our
 * pre-header timeout message. The body is still aborted and is NOT safe to
 * treat as an unsubmitted mutation or immediately retry a print operation.
 */
export const WORKSPACE_REAUTHENTICATION_EVENT = "yaseir:workspace-reauthentication-required";

/** Header-only UI signal: the caller retains the untouched response body. */
function notifyWorkspaceReauthentication(input: RequestInfo | URL, response: Response): void {
  if (typeof window === "undefined" || response.status !== 403) return;
  try {
    if (response.headers.get("X-Yaseir-Reauthentication") !== "required" || !response.url) return;
    const requestUrl = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      window.location.href,
    );
    const responseUrl = new URL(response.url);
    if (!["https:", "http:"].includes(requestUrl.protocol) || !["https:", "http:"].includes(responseUrl.protocol)) return;
    if (requestUrl.origin !== window.location.origin || responseUrl.origin !== window.location.origin) return;
    window.dispatchEvent(new Event(WORKSPACE_REAUTHENTICATION_EVENT));
  } catch {
    // An unavailable notification surface must never change request semantics.
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  // AbortSignal.timeout() owns its lifecycle; do not clear it at response
  // headers. AbortSignal.any() preserves caller cancellation *after* headers
  // and keeps the original response status, URL, streaming and clone contract.
  // fetch(Request, init) inherits the Request's signal unless init explicitly
  // supplies one (including null). Replacing it with only a deadline silently
  // sends an already-cancelled mutation and loses navigation cancellation.
  const callerSignal = init.signal === undefined && typeof Request !== "undefined" && input instanceof Request
    ? input.signal
    : init.signal;
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
  try {
    const response = await fetch(input, { ...init, signal });
    notifyWorkspaceReauthentication(input, response);
    return response;
  } catch (error) {
    if (deadline.aborted && !callerSignal?.aborted) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}
