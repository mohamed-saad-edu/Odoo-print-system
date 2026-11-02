"use client";

import Link from "next/link";
import { Card, CardHeader, PageHeader } from "../../../components/ui";
import { SessionInventory } from "../../../components/SessionInventory";
import { useI18n } from "../../../i18n/react";

// No step-up: platform session management needs only a valid platform
// session. Revoking sessions (including this device) is a one-click action
// in the inventory below; expired sessions go to platform sign-in.
export default function PlatformSecurityPage() {
  const { t } = useI18n();
  return <div className="space-y-6">
    <nav className="flex flex-wrap gap-4"><Link href="/platform/audit" className="underline">{t("platform.nav.audit")}</Link><Link href="/platform/database" className="underline">{t("platform.nav.database")}</Link></nav>
    <PageHeader variant="inline" title={t("security.title")}  />
    <Card><CardHeader title={t("security.title")} subtitle={t("security.platformSessionsHint")} /><div className="space-y-4 p-5">
      <p className="text-sm text-ink-3">{t("security.platformSessionsHint")}</p>
    </div></Card>
    <SessionInventory platform />
  </div>;
}
