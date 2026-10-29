import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasBodyOverLimit } from "../src/lib/request-limits";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("production hardening contracts", () => {
  it("retired checkout cannot create or recover provider activation intents", async () => {
    const route=read("src/app/api/billing/checkout/route.ts");
    expect(route).toContain("MANUAL_BILLING_REQUIRED");
    expect(route).toContain("status:410");
    expect(route).not.toContain("stripeRequest");
  });

  it("uses the transactional tenant lifecycle fence on runtime/control writes", () => {
    expect(read("src/lib/tenant-guard.ts")).toContain("requireActiveTenantInTransaction");
    expect(read("src/lib/tenant-guard.ts")).toContain("FOR SHARE");
    expect(read("src/lib/agent-lifecycle.ts")).toContain("requireActiveTenantInTransaction(tx, tenantId)");
    expect(read("src/app/actions.ts")).toContain("requireActiveTenantInTransaction(tx, manager.tenantId)");
    const register = read("src/app/api/agent/register/route.ts");
    const candidate = register.indexOf("const candidate = await tx.execute");
    const tenantIdentity = register.indexOf("const tenantId = (candidate.rows[0]");
    const tenantFence = register.indexOf("requireActiveTenantInTransaction(tx, tenantId)");
    const agentLock = register.indexOf("const agentResult = await tx.execute");
    expect(candidate).toBeGreaterThanOrEqual(0);
    expect(tenantIdentity).toBeGreaterThan(candidate);
    expect(tenantFence).toBeGreaterThan(tenantIdentity);
    expect(agentLock).toBeGreaterThan(tenantFence);
    const candidateQuery = register.slice(candidate, tenantIdentity);
    expect(candidateQuery).toContain("SELECT id FROM tenants");
    expect(candidateQuery).toContain("SELECT tenant_id FROM agents");
    expect(candidateQuery).toContain("pairing_code_hash = ${hashedCode}");
    expect(candidateQuery).toContain("pairing_code_expires_at > clock_timestamp()");
    expect(candidateQuery).toContain("FOR SHARE");
    const lockedAgentQuery = register.slice(agentLock, register.indexOf("const agent = agentResult.rows[0]", agentLock));
    expect(lockedAgentQuery).toContain("AND tenant_id = ${tenantId}");
    expect(lockedAgentQuery).toContain("FOR UPDATE");
    expect(read("src/app/api/agent/heartbeat/route.ts")).toContain("requireActiveTenantInTransaction(tx, agent.tenantId)");
    expect(read("src/app/api/agent/discovery/route.ts")).toContain("requireActiveTenantInTransaction(tx, agent.tenantId)");
    expect(read("src/app/api/agents/[id]/discovered-printers/[deviceId]/provision/route.ts")).toContain("requireActiveTenantInTransaction(tx, claims.tenantId)");
    expect(read("src/app/api/printers/[id]/route.ts")).toContain("requireActiveTenantInTransaction(tx, tenantId)");
  });

  it("rejects declared request bodies over the endpoint limit", () => {
    expect(hasBodyOverLimit(new Request("http://test", { headers: { "content-length": "1024" } }), 2048)).toBe(false);
    expect(hasBodyOverLimit(new Request("http://test", { headers: { "content-length": "2049" } }), 2048)).toBe(true);
    expect(hasBodyOverLimit(new Request("http://test", { headers: { "content-length": "-1" } }), 2048)).toBe(true);
    expect(hasBodyOverLimit(new Request("http://test", { headers: { "content-length": "1e3" } }), 2048)).toBe(true);
    expect(hasBodyOverLimit(new Request("http://test", { headers: { "content-length": "0x10" } }), 2048)).toBe(true);
    expect(hasBodyOverLimit(new Request("http://test", { headers: { "content-length": "1.5" } }), 2048)).toBe(true);
    expect(hasBodyOverLimit(new Request("http://test", { headers: { "content-length": "9007199254740993" } }), Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(hasBodyOverLimit(new Request("http://test"), 2048)).toBe(false);
  });

  it("fences agent-driven expiration at the database clock", () => {
    const route = read("src/app/api/agent/jobs/route.ts");
    const jobStatus = read("src/lib/job-status.ts");
    // claimed -> success is the agent's fenced RE-REPORT of a durable local
    // terminal result (duplicate delivery after a reclaim, or a re-report
    // after the printing report was lost). The claim token is still required,
    // so this grants no authority the token owner did not already have via
    // claimed -> printing -> success; see tests/job-status.test.ts.
    expect(jobStatus).toContain('claimed: new Set(["printing", "success", "failed", "queued"])');
    expect(jobStatus).toContain('printing: new Set(["success", "failed"])');
    expect(route).toContain('if (requestedStatus !== "expired") {');
    expect(route).toContain('if (!job.claimToken || !claimToken || claimToken !== job.claimToken) {');
    expect(route).toContain('requestedStatus === "expired"');
    expect(route).toContain('fencedJobWrite(jobId, agent.tenantId, agent.id, currentStatus, claimToken)');
    expect(route).toContain('sql`${printJobs.expiresAt} <= now()`');
    expect(route).toContain('code: "JOB_NOT_EXPIRED_OR_STALE"');
    expect(route).toContain('JOB_EXPIRED_DURING_PRINT: physical output is unknown');
    expect(route).toContain('UNKNOWN_PARTIAL_DELIVERY: job expired after possible delivery without an execution report');
    expect(route).toContain('OR ${printJobs.error} = ${DELIVERY_EVIDENCE_PENDING}');
  });

  it("does not log Odoo print-intent claim tokens", () => {
    const intent = read("odoo_addons/print_gateway/models/print_intent.py");
    expect(intent).not.toContain('token %s: %s", intent_id, claim_token, exc');
    expect(intent).not.toMatch(/_logger\.\w+\([^)]*\bclaim_token\b/s);
  });

  it("keeps the API body guard stream-safe without request cloning", () => {
    const server = read("server.ts");
    const guard = read("src/server/request-guard.ts");
    expect(server).toContain("guardApiRequest(req, res)");
    expect(server).not.toContain('req.on("data"');
    expect(guard).toContain("export const MAX_API_BODY_BYTES = 8 * 1024 * 1024;");
    expect(guard).toContain('const MUTATING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];');
    expect(guard).toContain("REQUEST_BODY_TOO_LARGE");
    expect(guard).toContain("MAX_CONCURRENT_CHUNKED_BYTES");
    expect(guard).not.toContain("cloneRequestWithBody");
    expect(guard).not.toContain("new IncomingMessage");
    expect(guard).toContain("CONTENT_LENGTH_REQUIRED");
  });

  it("keeps the bundled Caddy overwriting forwarded-IP headers and capping request bodies", () => {
    const caddy = read("Caddyfile");
    // The edge overwrites X-Forwarded-For with the real client address:
    // reverse_proxy appends to client-supplied values, so sanitize-by-default
    // does not stop leftmost-entry spoofing of per-IP rate-limit buckets.
    expect(caddy).toContain("header_up X-Forwarded-For {http.request.remote.host}");
    expect(caddy).toContain("header_up -X-Real-Ip");
    expect(caddy).toContain("max_size 8MiB");
  });

  it("fails closed in production when the platform tenant identity is not configured", () => {
    const server = read("server.ts");
    expect(server).toContain('runtimeSecret("PLATFORM_TENANT_ID")?.trim()');
    expect(server).toContain("<required-platform-tenant-id>");
    expect(server).toContain("PLATFORM_TENANT_ID must be configured with the real platform workspace ID");
    expect(server).toContain("Refusing production startup");
  });

  it("refuses production startup without a configured PostgreSQL identity", () => {
    const server = read("server.ts");
    expect(server).toContain('runtimeSecret("DATABASE_URL")?.trim()');
    expect(server).toContain("process.env.PGHOST?.trim()");
    expect(server).toContain("process.env.PGUSER?.trim()");
    expect(server).toContain("process.env.PGDATABASE?.trim()");
    expect(server).toContain("Refusing production startup: DATABASE_URL or PGHOST, PGUSER and PGDATABASE are required.");
  });

  it("avoids logging raw caller-supplied print operation keys", () => {
    for (const file of ["src/app/api/print/jobs/route.ts", "src/app/api/print/jobs/v2/route.ts"]) {
      const route = read(file);
      expect(route).toContain("operationIdentityProvided: Boolean(parsed.data.idempotencyKey)");
      expect(route).not.toContain("logError(\"print.job.create_failed\", { key:");
    }
  });

  it("keeps Docker migration out of runtime startup and orders Compose migration before gateway", () => {
    const dockerfile = read("Dockerfile");
    const compose = read("docker-compose.yml");
    expect(dockerfile).toContain('CMD ["node", "--import", "tsx", "server.ts"]');
    expect(dockerfile).not.toContain("npm run db:migrate && npm start");
    expect(dockerfile).toContain("rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx");
    expect(compose).toContain("migrate:");
    expect(compose).toContain('command: ["node", "--import", "tsx", "scripts/db-migrate.ts"]');
    expect(compose).toContain("service_completed_successfully");
    expect(compose).toContain("condition: service_healthy");
    expect(compose).toContain("PGHOST: postgres");
    expect(compose).toContain("PGPASSWORD_FILE: /run/secrets/postgres_runtime_password");
    expect(compose).toContain("PGPASSWORD_FILE: /run/secrets/postgres_owner_password");
    expect(compose).not.toContain("PGPASSWORD: ${POSTGRES_PASSWORD");
    expect(compose).not.toContain("DATABASE_URL: postgresql://");
    expect(read("src/db/index.ts")).toContain("runtimeSecret(\"PGPASSWORD\")");
    expect(read("src/lib/runtime-secret.ts")).toContain("${name}_FILE");
    expect(read("scripts/db-migrate.ts")).toContain("hasDatabaseSettings");
  });

  it("scopes Agent-generated printer and discovery identities to the tenant", () => {
    const schema = read("src/db/schema.ts");
    const printersBlock = schema.slice(schema.indexOf("export const printers = pgTable"));
    const printersTable = printersBlock.slice(0, printersBlock.indexOf("export const apiKeys"));
    expect(printersTable).toContain("id: text(\"id\").notNull()");
    expect(printersTable).not.toContain("id: text(\"id\").primaryKey()");
    expect(printersTable).toContain("unique(\"printers_tenant_id_unique\")");

    const discoveredBlock = schema.slice(schema.indexOf("export const discoveredDevices = pgTable"));
    const discoveredTable = discoveredBlock.slice(0, discoveredBlock.indexOf("export const printJobs"));
    expect(discoveredTable).toContain("id: text(\"id\").notNull()");
    expect(discoveredTable).not.toContain("id: text(\"id\").primaryKey()");
    expect(discoveredTable).toContain("unique(\"discovered_devices_tenant_agent_id_unique\")");

    const heartbeat = read("src/app/api/agent/heartbeat/route.ts");
    expect(heartbeat).toContain("onConflictDoNothing({ target: [printers.tenantId, printers.id] })");
    expect(heartbeat).not.toContain("onConflictDoNothing({ target: printers.id })");

    const discoveryReport = read("src/app/api/agent/discovery/route.ts");
    expect(discoveryReport).toContain(".onConflictDoUpdate({");
    expect(discoveryReport).toContain("target: [discoveredDevices.tenantId, discoveredDevices.agentId, discoveredDevices.identityKey]");

    const migration = read("drizzle/0072_tenant_scoped_printer_identity.sql");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS \"printers_pkey\"");
    expect(migration).toContain("DROP INDEX IF EXISTS \"printers_gateway_id_global_unique\"");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS \"discovered_devices_pkey\"");

    const odooPrinters = read("src/app/api/odoo/printers/route.ts");
    expect(odooPrinters).toContain("and(eq(printers.agentId, agents.id), eq(printers.tenantId, agents.tenantId))");
    expect(odooPrinters).not.toContain(".innerJoin(agents, eq(printers.agentId, agents.id))");

    const platformStats = read("src/app/api/platform/stats/route.ts");
    expect(platformStats).toContain("and(eq(printers.agentId, agents.id), eq(printers.tenantId, agents.tenantId))");

    expect(discoveryReport).toContain("eq(discoverySessions.tenantId, agent.tenantId)");
  });

  it("keeps Drizzle journal entries unique and aligned with migration files", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: Array<{ tag: string }> };
    const tags = journal.entries.map((entry) => entry.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags).toContain("0012_runtime_state_checks");
    expect(tags).toContain("0013_runtime_state_constraint_scope_fix");
    expect(tags).toContain("0014_discovery_state_checks");
    expect(tags).toContain("0015_metrics_and_agent_notifications");
    expect(tags).toContain("0016_print_job_rate_limits");
    expect(tags).toContain("0017_notify_requeued_jobs");
    expect(tags).toContain("0021_scope_print_jobs_to_api_key");
    expect(tags).toContain("0049_tenant_scoped_idempotency_and_owner_unique");
    expect(read("drizzle/0013_runtime_state_constraint_scope_fix.sql")).toContain("current_schema()");
    expect(read("drizzle/0014_discovery_state_checks.sql")).toContain("discovered_devices_candidate_status_check");
  });

  it("does not silently restore the old auto-provision discovery path", () => {
    const provision = read("src/app/api/agents/[id]/discovered-printers/[deviceId]/provision/route.ts");
    const verify = read("src/app/api/agents/[id]/discovered-printers/[deviceId]/verify/route.ts");
    expect(provision).toContain('code: "DEVICE_NOT_APPROVED"');
    expect(provision).toContain('row.verification !== "verified"');
    expect(provision).toContain("UNSUPPORTED_DISCOVERY_TRANSPORT");
    expect(provision).not.toContain('wsd: "raw"');
    expect(provision).not.toContain('mdns: "ipp"');
    expect(provision).not.toContain('snmp: "raw"');
    expect(provision).not.toContain('usb: "raw"');
    expect(verify).toContain('verification: "verified"');
    expect(verify).toContain('candidateStatus: "verified"');
  });

  it("keeps the dashboard focused on runtime agents, printers, and jobs", () => {
    const dashboard = read("src/app/dashboard/dashboard-client.tsx");
    expect(dashboard).toContain('t("dashboard.tab.printers")');
    expect(dashboard).toContain('t("dashboard.tab.jobs")');
    expect(dashboard).not.toContain("candidateStatus");
    expect(dashboard).not.toContain("Technical confidence remains unchanged");
  });

  it("does not silently discard drawer-kick transport failures", () => {
    const agent = read("agent/internal/agent/agent.go");
    expect(agent).toContain("peripheral_drawer_kick_failed");
    expect(agent).toContain("printer.OutcomeUnknown(drawerErr)");
    expect(agent).toContain("physicalPeripheralSideEffect = true");
    expect(agent).toContain("UNKNOWN_PARTIAL_DELIVERY: peripheral side effect succeeded");
  });

  it("never downgrades an agent panic after BeginPrint into an ordinary retryable failure", () => {
    const agent = read("agent/internal/agent/agent.go");
    expect(agent).toContain('func classifyPanicOutcome(');
    expect(agent).toContain('found && localStatus == "printing"');
    expect(agent).toContain('return "failed", "UNKNOWN_PARTIAL_DELIVERY: " + panicMsg');
    expect(agent).toContain('status, panicMsg := classifyPanicOutcome(');
    expect(agent).toContain('a.queue.UpdateStatusWithError(jobID, "failed", panicMsg)');
    expect(agent).toContain('a.rememberTerminalExecution(jobID, "failed", panicMsg, fields.ClaimToken, "")');
  });

  it("keeps tenant scoping fail-closed in manager dashboard and agent lifecycle routes", () => {
    const dashboard = read("src/app/dashboard/page.tsx");
    const lifecycle = read("src/app/api/agents/[id]/route.ts");
    const helper = read("src/lib/agent-lifecycle.ts");
    const dashboardState = read("src/lib/dashboard-state.ts");
    expect(dashboard).toContain("loadDashboardStateForTenant(claims.tenantId, {}, tx)");
    expect(dashboard).toContain("await requireActiveTenantInTransaction(tx, claims.tenantId);");
    expect(dashboard).toContain('await requireManagerActorInTransaction(tx, claims, "jobs.read");');
    expect(dashboardState).toContain("eq(agents.tenantId, tenantId)");
    expect(dashboardState).toContain("eq(printers.tenantId, tenantId)");
    // The dashboard delegates jobs to the shared history reader. Both live
    // jobs and archived receipts MUST carry the tenant parameter into SQL.
    const history = read("src/lib/job-history.ts");
    expect(dashboardState).toContain("listPrintJobHistory({");
    expect(history).toContain('sql`WHERE j.tenant_id = ${tenantId}`');
    expect(history).toContain('sql`WHERE r.tenant_id = ${tenantId}`');
    expect(history).toContain('FROM print_jobs j ${scopedWhere("j", input.tenantId)}');
    expect(history).toContain('FROM print_job_receipts r ${scopedWhere("r", input.tenantId)}');
    expect(lifecycle).toContain("transitionAgentLifecycle(id, lifecycle, claims.tenantId, {");
    expect(helper).toContain("eq(agents.tenantId, tenantId)");
    expect(helper).not.toContain("tx.update(printers)");
  });

  it("keeps stock validation automated policy dispatch centralized", () => {
    const stock = read("odoo_addons/print_gateway/models/stock_picking.py");
    expect(stock).toContain("dispatch_for_record");
    expect(stock).toContain("\"picking_validated\"");
    expect(stock).not.toContain("resolve_for_record");
    expect(stock).not.toContain("effective_target_key");
    expect(stock).not.toContain("create_and_route(policy, picking");
  });

  it("keeps Gateway job expiry validation on PostgreSQL clock", () => {
    const service = read("src/lib/print-job-service.ts");
    const route = read("src/app/api/print/jobs/route.ts");
    expect(service).toContain("clock_timestamp()");
    expect(service).toContain("expiresAt must be in the future");
    expect(service).not.toContain("new Date(Date.now() + 60 * 60 * 1000)");
    expect(service).not.toContain("expiresAt.getTime() <= Date.now()");
    expect(route).not.toContain("const now = Date.now()");
    expect(route).not.toContain("parsed.getTime() <= now");
  });

  it("keeps direct print submission printer-scoped and payload-validated", () => {
    const route = read("src/app/api/print/jobs/route.ts");
    expect(route).toContain("validatePrintJobPayload(parsed.data.payload)");
    expect(route).toContain("printerId");
    expect(route).not.toContain("branchId");
    expect(route).not.toContain("branch_id");
    expect(route).not.toContain("destinationId");
  });

  it("keeps agent lifecycle auditing single-writer and selection-token consumption conflict-safe", () => {
    const actions = read("src/app/actions.ts");
    const lifecycleStart = actions.indexOf("export async function setAgentLifecycle");
    const lifecycleEnd = actions.indexOf("export async function getDashboardState");
    expect(lifecycleStart).toBeGreaterThanOrEqual(0);
    expect(lifecycleEnd).toBeGreaterThan(lifecycleStart);
    const lifecycleAction = actions.slice(lifecycleStart, lifecycleEnd);
    expect(lifecycleAction).not.toContain("writeAuditEvent");
    expect(lifecycleAction).toContain("transitionAgentLifecycle");
    expect(lifecycleAction).toContain('lifecycle === "retired" ? "agents.retire" : "agents.disable"');

    const selectTenant = read("src/app/api/auth/select-tenant/route.ts");
    expect(selectTenant).toContain("onConflictDoNothing");
    expect(selectTenant).toContain("returning({ key: authRateLimits.key })");
    expect(selectTenant).toContain("Selection token already used");
    expect(selectTenant).not.toContain(`catch {
          throw new Error("Selection token already used")`);
  });

  it("keeps control-plane concurrency boundaries enforced by code and schema", () => {
    const invitation = read("src/app/api/team/invitations/accept/route.ts");
    expect(invitation).toContain("FROM tenants");
    expect(invitation).toContain("FOR UPDATE");
    const enrollment = read("src/lib/invitation-join.ts");
    expect(invitation).toContain('lockedTenant.rows[0]?.lifecycle !== "active"');
    expect(enrollment).toContain('tenant.rows[0].lifecycle !== "active"');
    expect(enrollment).toContain('action: "team.invitation.accepted"');
    expect(enrollment).toContain("}, tx);");

    const onboarding = read("src/app/api/onboarding/route.ts");
    const privileged = read("src/app/api/team/invitations/route.ts");
    expect(onboarding).toContain("PLATFORM_OWNER_REQUIRED");
    expect(onboarding).not.toContain("ensurePendingManualSubscription");
    expect(privileged).toContain("FOR UPDATE");
    expect(privileged).toContain("requireWorkspaceOwnerForInvites");
    const manual=read("src/lib/manual-subscriptions.ts");
    expect(manual).toContain("requirePlatformActorInTransaction(tx,actor)");
    expect(manual).toContain("SUBSCRIPTION_REVISION_CONFLICT");
    expect(manual).toContain("IDEMPOTENCY_CONFLICT");
    expect(manual).toContain("FOR UPDATE");

    const lifecycle = read("src/lib/tenant-lifecycle.ts");
    expect(lifecycle).toContain('PLATFORM_TENANT_PROTECTED');
    
    const discovery = read("src/app/api/agents/[id]/discovery/route.ts");
    expect(discovery).toContain("FOR UPDATE");
    expect(discovery).toContain("DISCOVERY_ALREADY_RUNNING");
    const schema = read("src/db/schema.ts");
    expect(schema).toContain("discovery_sessions_active_agent_unique");
    expect(schema).toContain("print_jobs_tenant_idempotency_unique");
    expect(schema).toContain("tenant_users_single_owner_idx");

    const printService = read("src/lib/print-job-service.ts");
    expect(printService).toContain("print_jobs:idempotency:");
    expect(printService).toContain("WHERE tenant_id = ${tenantId}");
    expect(printService).toContain("idempotency_key = ${effectiveIdempotencyKey}");
    expect(printService).toContain("status IN ('queued', 'claimed', 'printing')");
    expect(printService).toContain("const escapedReprintId = reprintOfJobId.replace");
    expect(printService).toContain('.replace(/%/g, "\\\\%")');
    expect(printService).toContain('.replace(/_/g, "\\\\_")');
    expect(printService).toContain("gw-reprint:${escapedReprintId}:%");
    expect(printService).toContain("ESCAPE '\\\\'");

    const printRoute = read("src/app/api/print/jobs/route.ts");
    expect(printRoute).not.toContain("eq(printJobs.apiKeyId, odoo.id), eq(printJobs.idempotencyKey");
    // Replay matching moved into the transactional service. Its credential
    // fence must run BEFORE either the historical receipt or live-job lookup;
    // the HTTP handler must not reintroduce an unlocked fast-path read.
    expect(printRoute).toContain("const result = await createPrintJobForPrinter(");
    expect(printRoute).toContain("idempotencyKey: parsed.data.idempotencyKey ?? null,");
    expect(printRoute).toContain("rateLimitKeyId: odoo.id,");
    expect(printRoute).toContain("tenantId: odoo.tenantId,");
    expect(printRoute).not.toContain("eq(printJobs.idempotencyKey, parsed.data.idempotencyKey)");
    expect(printRoute).toContain("readOdooJobStatus(odoo, identity,");
    const statusScope = read("src/lib/odoo-status-scope.ts");
    expect(statusScope).toContain("eq(printJobs.tenantId, key.tenantId)");
    expect(statusScope).toContain("eq(printJobs.idempotencyKey, lookup.idempotencyKey!)");
    expect(statusScope).toContain("isNotNull(printJobs.apiKeyId)");
    const statusGuard = statusScope.indexOf("await requireOdooStatusAccess(tx, key, identity)");
    expect(statusGuard).toBeGreaterThan(-1);
    expect(statusScope.indexOf("await tx.query.printJobs.findFirst")).toBeGreaterThan(statusGuard);
    expect(statusScope.indexOf("await tx.query.printJobReceipts.findFirst")).toBeGreaterThan(statusGuard);
    const keyFence = printService.indexOf("WHERE id = ${rateLimitKeyId} AND tenant_id = ${tenantId}");
    const firstReceiptRead = printService.indexOf("const receipt = await tx.query.printJobReceipts.findFirst");
    const firstJobRead = printService.indexOf("const existing = await tx.execute(sql`SELECT id, printer_id");
    expect(keyFence).toBeGreaterThan(-1);
    const fencedCredential = printService.slice(keyFence, printService.indexOf("if (!credential.rows.length)", keyFence));
    expect(fencedCredential).toContain("AND revoked_at IS NULL AND read_only_until IS NULL AND odoo_enabled = TRUE");
    expect(fencedCredential).toContain("FOR UPDATE");
    expect(firstReceiptRead).toBeGreaterThan(keyFence);
    expect(firstJobRead).toBeGreaterThan(keyFence);
    expect(printRoute).not.toContain("eq(printJobs.id, id), eq(printJobs.tenantId, odoo.tenantId), eq(printJobs.apiKeyId, odoo.id)");
    const reusedBlock = printRoute.slice(printRoute.indexOf("if (result.isReused)"), printRoute.indexOf("return NextResponse.json({\n      jobId:", printRoute.indexOf("if (result.isReused)")));
    expect(reusedBlock).toContain("readOdooJobStatus(");

    const batchStatus = read("src/app/api/print/jobs/batch-status/route.ts");
    expect(batchStatus).toContain("eq(printJobs.tenantId, odoo.tenantId)");
    expect(batchStatus).toContain("isNotNull(printJobs.apiKeyId)");
    expect(batchStatus).not.toContain("eq(printJobs.apiKeyId, odoo.id)");

    const auth = read("src/lib/manager-auth.ts");
    expect(auth).toContain("passwordHash: true");
    expect(auth).toContain("eq(users.passwordHash, legacyHash)");
    // Unverified and nonexistent accounts must perform the dummy password
    // verification BEFORE the denial; a literal one-line return assertion
    // would reject this side-channel-hardening improvement.
    const deniedCustomerLogin = auth.match(/if \(!row \|\| !row\.emailVerifiedAt\) \{([^}]+)\}/)?.[1];
    expect(deniedCustomerLogin).toBeDefined();
    expect(deniedCustomerLogin).toMatch(/await burnPasswordVerification\(password\);\s*return null;/);
    expect(auth).toContain("if (upgradedRows.length !== 1) return null;");

    // Retired customer billing endpoints remain disabled.
    for (const [path] of [
      ["src/app/api/billing/cancel/route.ts", "cancel"],
      ["src/app/api/billing/resume/route.ts", "resume"],
    ] as const) {
      const billingRoute = read(path);
      expect(billingRoute).toContain("MANUAL_BILLING_REQUIRED");
      expect(billingRoute).toContain("status:410");
      expect(billingRoute).not.toContain("runBillingOperation(");
    }
  });

});

it("legacy crash reprint is refused separately from safe pre-execution rejection", () => {
  const source = read("src/app/api/agent/jobs/route.ts");
  const status = read("src/lib/job-status.ts");
  expect(status).toContain('AGENT_REPRINT_AFTER_CRASH_REASON = "agent_reprint_after_crash"');
  const refusal = source.slice(source.indexOf('if (requestedStatus === "queued" && currentStatus === "printing")'), source.indexOf('if (requestedStatus === "queued" && currentStatus === "claimed")'));
  expect(refusal).toContain('UNKNOWN_OUTCOME_REPRINT_FORBIDDEN');
  expect(refusal).toContain('physicalOutcome: "unknown"');
  expect(refusal).not.toContain('db.update');
  expect(source).toContain('retries: sql`${printJobs.retries} + 1`');
});
