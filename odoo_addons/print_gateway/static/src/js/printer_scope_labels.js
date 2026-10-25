/** @odoo-module */

/**
 * Each option represents an Odoo company *record*, never just its display name.
 * Identically named branches and roots must be distinguishable even if an
 * older server sends ambiguous labels. The server still owns all authorization
 * and exact company/branch routing decisions.
 */
export function labelPrinterScopes(scopes, labels = {}) {
    if (!Array.isArray(scopes)) return [];
    const companyLabel = labels.company || "Company";
    const branchLabel = labels.branch || "Branch";
    const unavailableLabel = labels.unavailable || "Unavailable";
    const seenIds = new Set();
    const unique = [];
    for (const scope of scopes) {
        if (!scope || typeof scope !== "object") continue;
        const id = Number(scope.id);
        if (typeof scope.id === "boolean" || !Number.isSafeInteger(id) || id <= 0 || seenIds.has(id)) continue;
        seenIds.add(id);
        const name = typeof scope.name === "string" && scope.name.trim()
            ? scope.name.trim() : `#${id}`;
        const kind = scope.branchId ? branchLabel : companyLabel;
        unique.push({ ...scope, id, name, baseLabel: `${kind}: ${name}` });
    }
    const counts = new Map();
    for (const scope of unique) {
        const key = scope.baseLabel.toLocaleLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    const usedLabels = new Set();
    return unique.map(({ baseLabel, ...scope }) => {
        const duplicate = counts.get(baseLabel.toLocaleLowerCase()) > 1;
        let label = duplicate ? `${baseLabel} (#${scope.id})` : baseLabel;
        const availabilitySuffix = scope.assignable === false ? ` (${unavailableLabel})` : "";
        // A company can literally be named "My Company (#2)" or
        // "My Company (Unavailable)". Compare the actual visible label,
        // including unavailable status, before publishing each option.
        while (usedLabels.has(`${label}${availabilitySuffix}`.toLocaleLowerCase())) {
            label = `${label} (#${scope.id})`;
        }
        const visibleLabel = `${label}${availabilitySuffix}`;
        usedLabels.add(visibleLabel.toLocaleLowerCase());
        return { ...scope, label: visibleLabel };
    });
}

/**
 * Never auto-bind a revoked/stale branch to a different company's first printer.
 * An explicit branch takes priority over its root; absent/invalid explicit
 * scopes fail closed even if another authorized company exists. IDs from Odoo
 * action contexts may arrive as numbers or decimal strings.
 */
export function resolvePrinterScopeSelection(scopes, {
    requestedBranchId, requestedCompanyId, currentCompanyId,
} = {}) {
    const present = value => value !== undefined && value !== null && value !== false && value !== "";
    const parseId = value => {
        if (typeof value !== "number" && typeof value !== "string") return 0;
        const id = Number(value);
        return Number.isSafeInteger(id) && id > 0 ? id : 0;
    };
    const find = id => (Array.isArray(scopes) ? scopes : []).find(
        scope => scope.id === id && scope.assignable !== false,
    );
    if (present(requestedBranchId)) {
        const branchId = parseId(requestedBranchId);
        const branch = find(branchId);
        const rootId = present(requestedCompanyId) ? parseId(requestedCompanyId) : 0;
        return branch && parseId(branch.branchId) === branchId &&
            (!present(requestedCompanyId) || parseId(branch.companyId) === rootId)
            ? { id: branchId, invalidated: false }
            : { id: 0, invalidated: true };
    }
    if (present(requestedCompanyId)) {
        const requestedId = parseId(requestedCompanyId);
        return find(requestedId)
            ? { id: requestedId, invalidated: false }
            : { id: 0, invalidated: true };
    }
    const activeId = parseId(currentCompanyId);
    return find(activeId)
        ? { id: activeId, invalidated: false }
        : { id: 0, invalidated: present(currentCompanyId) };
}
