import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../../lib/manager-mutation-authorization";
import { NextResponse } from "next/server";
import { db } from "../../../db";
import { plans, tenantSubscriptions, tenants } from "../../../db/schema";
import { and, eq, sql } from "drizzle-orm";
import { validateWorkspaceManager } from "../../../lib/manager-auth";
import { hasBodyOverLimit } from "../../../lib/request-limits";
import { ensurePendingManualSubscription } from "../../../lib/manual-subscriptions";
import { writeAuditEvent } from "../../../lib/audit";

export async function GET(req: Request) {
  const claims = await validateWorkspaceManager(req);
  if (!claims?.userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  const [rows, tenant, subscription] = await Promise.all([
    db.select({ id: plans.id, name: plans.name, entitlements: plans.entitlements, currency: plans.currency, interval: plans.interval })
      .from(plans).where(and(eq(plans.isActive, true), eq(plans.isPublic, true))),
    db.query.tenants.findFirst({ where: eq(tenants.id, claims.tenantId), columns: { id: true, name: true } }),
    db.query.tenantSubscriptions.findFirst({ where: eq(tenantSubscriptions.tenantId, claims.tenantId), columns: { planId: true, status: true, currentPeriodEnd: true } }),
  ]);
  let agentDownloadUrl: string | null = null;
  try {
    const url = new URL(process.env.YASEIR_AGENT_DOWNLOAD_URL ?? "");
    if (url.protocol === "https:" && !url.username && !url.password) agentDownloadUrl = url.href;
  } catch { /* A release URL must be explicitly configured. */ }
  return NextResponse.json({ tenant, role: claims.role, plans: rows, subscription, agentDownloadUrl }, { headers: { "Cache-Control": "no-store" } });
}

/** Workspace identity only. Commercial access is exclusively granted by the Platform Owner. */
export async function POST(req: Request) {
  if (hasBodyOverLimit(req, 32 * 1024)) return NextResponse.json({ error: "Request body too large", code: "REQUEST_TOO_LARGE" }, { status: 413 });
  const claims = await validateWorkspaceManager(req);
  if (!claims?.userId) return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  if (claims.role !== "owner") return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); }
  catch { return NextResponse.json({ error: "Invalid JSON", code: "INVALID_JSON" }, { status: 400 }); }
  // Reject legacy self-activation explicitly instead of silently accepting it.
  if (body.trial !== undefined) return NextResponse.json({ error: "Activation requires Platform Owner approval", code: "MANUAL_ACTIVATION_REQUIRED" }, { status: 400 });
  const name = typeof body.workspaceName === "string" ? body.workspaceName.trim() : "";
  const planId = typeof body.planId === "string" ? body.planId.trim() : "";
  if (name.length < 2 || name.length > 120 || !planId || planId.length > 128)
    return NextResponse.json({ error: "Workspace name and plan are required", code: "ONBOARDING_INVALID" }, { status: 400 });
  try {
    await db.transaction(async (tx) => {
      const tenant = await tx.execute(sql`SELECT id, lifecycle FROM tenants WHERE id = ${claims.tenantId} FOR UPDATE`);
      if (!tenant.rows[0]?.id) throw new Error("TENANT_NOT_FOUND");
      if (tenant.rows[0].lifecycle !== "active") throw new Error("TENANT_NOT_ACTIVE");
      await requireManagerActorInTransaction(tx, claims, "tenant.update");
      const plan = await tx.query.plans.findFirst({ where: and(eq(plans.id, planId), eq(plans.isActive, true), eq(plans.isPublic, true)), columns: { id: true } });
      if (!plan) throw new Error("PLAN_NOT_FOUND");
      await tx.update(tenants).set({ name, updatedAt: sql`now()` }).where(eq(tenants.id, claims.tenantId));
      await ensurePendingManualSubscription(tx, claims.tenantId, plan.id);
      await writeAuditEvent({ tenantId: claims.tenantId, actorType: "user", actorId: claims.userId,
        action: "tenant.onboarding.saved", resourceType: "tenant", resourceId: claims.tenantId, metadata: { requestedPlanId: plan.id } }, tx);
    });
  } catch (error) {
    if (error instanceof ManagerMutationAuthorityChangedError) return error.response();
    if (error instanceof Error && error.message === "TENANT_NOT_FOUND") return NextResponse.json({ error: "Workspace not found", code: "TENANT_NOT_FOUND" }, { status: 404 });
    if (error instanceof Error && error.message === "TENANT_NOT_ACTIVE") return NextResponse.json({ error: "Workspace unavailable", code: "TENANT_SUSPENDED" }, { status: 403 });
    if (error instanceof Error && error.message === "PLAN_NOT_FOUND") return NextResponse.json({ error: "Plan not found", code: "ONBOARDING_INVALID" }, { status: 400 });
    throw error;
  }
  return NextResponse.json({ ok: true, tenantId: claims.tenantId, next: "/onboarding" });
}
