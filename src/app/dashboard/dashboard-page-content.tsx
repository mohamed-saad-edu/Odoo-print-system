import type { ReactNode } from "react";
import { sessionCookieName } from "../../lib/session-config";
import { logError } from "../../lib/log";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getManagerCookieName, verifyWorkspaceTokenFromCookieValues } from "../../lib/manager-auth";
import { hasManagerPermission } from "../../lib/authorization";
import DashboardClient, { type DashboardView } from "./dashboard-client";
import { JobCleanupButton } from "../../components/JobCleanupButton";
import { Database } from "lucide-react";
import { Callout, PageContainer, PageHeader, StatusBadge } from "../../components/ui";
import { BreadcrumbTrail } from "../../components/visual-system";
import { getServerLocale, makeT } from "../../i18n/server";
import type { MessageKey } from "../../i18n/messages/en";
import { loadDashboardStateForTenant } from "../../lib/dashboard-state";
import { db } from "../../db";
import { requireActiveTenantInTransaction, TenantSuspendedError, TenantDeletedError } from "../../lib/tenant-guard";
import { requireManagerActorInTransaction, ManagerMutationAuthorityChangedError } from "../../lib/manager-mutation-authorization";

/**
 * WP8: one server loader for the whole Operations group (/dashboard,
 * /agents, /printers, /jobs). The four pages share one auth gate, one
 * tenant guard and one fleet snapshot — they differ only in header and
 * in the locked view handed to DashboardClient. This is deliberately
 * NOT a route/auth change: the permission gate below is copied verbatim
 * from the old dashboard/page.tsx (agents.read + printers.read +
 * jobs.read, billing.read fallback), and the server fences stay
 * authoritative; the sidebar only decides what is shown, never what is
 * allowed.
 */
export default async function DashboardPageContent({
  view,
  locked,
  titleKey,
  descriptionKey,
  headerIcon,
  showCleanup = false,
}: {
  view: DashboardView;
  /** A dedicated page locks its view; /dashboard stays unlocked (home). */
  locked: boolean;
  titleKey: MessageKey;
  descriptionKey?: MessageKey;
  headerIcon: ReactNode;
  /** History cleanup stays on Home only — one control, not a duplicate. */
  showCleanup?: boolean;
}) {
  const t = makeT(await getServerLocale());
  const cookieStore = await cookies();
  const claims = await verifyWorkspaceTokenFromCookieValues(
    cookieStore.get(sessionCookieName("customer"))?.value ?? null,
    cookieStore.get(getManagerCookieName())?.value ?? null,
  );
  if (!claims) redirect("/login");
  if (
    !hasManagerPermission(claims, "agents.read") ||
    !hasManagerPermission(claims, "printers.read") ||
    !hasManagerPermission(claims, "jobs.read")
  ) {
    redirect(hasManagerPermission(claims, "billing.read") ? "/billing" : "/");
  }

  let dashboardState: Awaited<ReturnType<typeof loadDashboardStateForTenant>> | null = null;
  let databaseError: string | null = null;

  try {
    dashboardState = await db.transaction(async tx => {
      // Initial SSR props are an authenticated data export: the API's live
      // authority fence must cover the entire fleet and job-history snapshot.
      await requireActiveTenantInTransaction(tx, claims.tenantId);
      await requireManagerActorInTransaction(tx, claims, "jobs.read");
      return loadDashboardStateForTenant(claims.tenantId, {}, tx);
    });
  } catch (error: unknown) {
    if (error instanceof ManagerMutationAuthorityChangedError) {
      redirect(error.status === 401 ? "/login?next=%2Fdashboard" : "/");
    }
    if (error instanceof TenantSuspendedError || error instanceof TenantDeletedError) {
      redirect("/");
    }
    // Dotted event name (aggregation-safe) and a string message — a live
    // Error would serialize as {} and lose the failure reason.
    logError("dashboard.database_load_failed", { error: error instanceof Error ? error.message : String(error) });
    databaseError = t("dashboard.page.databaseLoadFailedLog");
  }

  // Effective permissions drive client controls: read-authorized roles must
  // not be offered mutations that end in predictable 403s, and retired
  // printers must not be offered reactivation the server rejects (C058).
  // Server fences stay authoritative; this only shapes the UI.
  const canMutate = {
    printers: hasManagerPermission(claims, "printers.manage"),
    agentsPair: hasManagerPermission(claims, "agents.pair"),
    agentsLifecycle: hasManagerPermission(claims, "agents.disable") || hasManagerPermission(claims, "agents.retire"),
    jobsCancel: hasManagerPermission(claims, "jobs.cancel"),
    jobsRetry: hasManagerPermission(claims, "jobs.retry"),
  };

  return (
    <>
      <PageHeader
        width="wide"
        icon={headerIcon}
        title={t(titleKey)}
        description={descriptionKey ? t(descriptionKey) : undefined}
        breadcrumbs={
          locked ? (
            <BreadcrumbTrail
              parent={t("v4.experience.home")}
              current={t(titleKey)}
              label={t("nav.consoleNavigation")}
            />
          ) : undefined
        }
        meta={
          <StatusBadge
            tone={databaseError ? "bad" : "ok"}
            pulse={false}
            label={databaseError ? t("dashboard.page.dbUnavailableBadge") : t("dashboard.page.snapshotLoaded")}
          />
        }
        actions={showCleanup && !databaseError && canMutate.jobsCancel ? <details className="rounded-lg border border-edge px-3 py-2"><summary className="cursor-pointer text-sm text-ink-2">{t("v4.experience.cleanupHistory")}</summary><div className="mt-3"><JobCleanupButton /></div></details> : undefined}
      />

      <PageContainer width="wide">
        {databaseError ? (
          <Callout
            tone="bad"
            title={t("dashboard.page.dbUnavailableTitle")}
            icon={<Database className="h-4 w-4" />}
          >
            {t("dashboard.page.dbUnavailableBody")}
          </Callout>
        ) : (
          <DashboardClient
            initialView={view}
            lockedView={locked ? view : undefined}
            diagnosticActorScope={`${claims.tenantId}:${claims.userId ?? "legacy"}:${claims.role}`}
            initialAgents={dashboardState!.agents}
            initialPrinters={dashboardState!.printers}
            initialJobs={dashboardState!.jobs}
            initialFleet={dashboardState!.fleet}
            databaseError={null}
            canMutate={canMutate}
            canReadBillingUsage={hasManagerPermission(claims, "billing.read")}
          />
        )}
      </PageContainer>
    </>
  );
}
