"use client";
import Link from "next/link";
import { Card, PageHeader } from "../../../components/ui";
import { useI18n } from "../../../i18n/react";

export default function Operations() {
  const { t } = useI18n();
  const cards = [
    { path: "fleet", label: "v4.admin.devices", description: "v4.admin.operationsDescDevices" },
    { path: "jobs", label: "v4.admin.jobs", description: "v4.admin.operationsDescJobs" },
    { path: "integrations", label: "v4.admin.integrations", description: "v4.admin.operationsDescIntegrations" },
  ] as const;
  return (
    <div className="space-y-6">
      <PageHeader variant="inline" title={t("v4.admin.operations")} />
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((card) => (
          <Link key={card.path} href={`/platform/${card.path}`}>
            <Card className="p-6">
              <p className="text-lg font-semibold">{t(card.label)}</p>
              <p className="mt-1 text-sm text-ink-3">{t(card.description)}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
