const SQLSTATE_CATEGORIES: ReadonlyMap<string, string> = new Map([
  ["55P03", "database_lock_not_available"],
  ["57014", "database_query_canceled"],
  ["40P01", "database_deadlock"],
  ["40001", "database_serialization_failure"],
  ["08006", "database_connection_failure"],
  ["57P01", "database_admin_shutdown"],
]);

const MAX_ERROR_NODES = 5;

/**
 * Drizzle's message contains SQL and parameters; its cause holds the driver
 * error. Emit only a recognized SQLSTATE and fixed category. No message,
 * stack, query, parameters, driver detail or arbitrary property is copied.
 *
 * Inspect only own data properties, without invoking accessors or traversing
 * prototypes. Bound the cause walk and tolerate cycles or hostile proxies.
 * These categories describe the error; they do not authorize a retry or prove
 * that a cancellation was caused by a particular timeout.
 */
export function databaseErrorLogFields(error: unknown): { errorCategory: string; sqlState?: string } {
  let current = error;
  const seen = new Set<object>();
  for (let nodes = 0; nodes < MAX_ERROR_NODES; nodes++) {
    if (current === null || typeof current !== "object" || seen.has(current)) break;
    seen.add(current);
    try {
      const code: unknown = Object.getOwnPropertyDescriptor(current, "code")?.value;
      if (typeof code === "string" && code.length === 5) {
        const category = SQLSTATE_CATEGORIES.get(code);
        if (category) return { errorCategory: category, sqlState: code };
      }
      current = Object.getOwnPropertyDescriptor(current, "cause")?.value;
    } catch {
      // An error object must not replace the original HTTP failure while it
      // is being inspected for operational logging.
      break;
    }
  }
  return { errorCategory: "internal_error" };
}
