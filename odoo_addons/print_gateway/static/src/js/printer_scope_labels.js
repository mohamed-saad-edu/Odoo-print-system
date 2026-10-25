/** @odoo-module */

/**
 * Provide unique, human-readable labels for all authorized Odoo company IDs.
 *
 * A display name is NOT an identity: two separate companies/branches can
 * share the same name, and legacy servers may return duplicate company IDs.
 * Never combine different IDs or modify the companyId/branchId used by the
 * printer assignment and dispatch APIs. This is only a UI safeguard; the
 * server remains the authority for company and branch permissions.
 *
 * @param {unknown} scopes Odoo /print_gateway/setup-context scopes
 * @param {{company?: string, branch?: string}} labels Localized words
 * @returns {Array<object>} Same authorized scopes with a unique display label
 */
export function labelPrinterScopes(scopes, labels = {}) {
    if (!Array.isArray(scopes)) return [];
    const companyLabel = labels.company || "Company";
    const branchLabel = labels.branch || "Branch";
    const seenIds = new Set();
    const unique = [];
    for (const scope of scopes) {
        if (!scope || typeof scope !== "object") continue;
        const id = Number(scope.id);
        if (!Number.isSafeInteger(id) || id <= 0 || seenIds.has(id)) continue;
        seenIds.add(id);
        const name = typeof scope.name === "string" && scope.name.trim()
            ? scope.name.trim() : `#${id}`;
        unique.push({ ...scope, id, name });
    }
    const counts = new Map();
    for (const scope of unique) {
        const key = scope.name.toLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return unique.map((scope) => {
        const duplicate = counts.get(scope.name.toLowerCase()) > 1;
        const typeLabel = scope.branchId ? branchLabel : companyLabel;
        return {
            ...scope,
            label: duplicate ? `${scope.name} — ${typeLabel} #${scope.id}` : scope.name,
        };
    });
}
