"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { useI18n } from "../../i18n/react";
import { ensureCustomerSession } from "../../lib/session-config";
import { fetchWithTimeout } from "../../lib/fetch-timeout";
import { Avatar, Button, Card, CardHeader, PageContainer, PageHeader, StatusBadge } from "../../components/ui";

type Member = { userId: string; email: string };
const PAGE_SIZE = 50;

/** Workspace teammates have one fixed operational access level, no selectable roles. */
export default function TeamPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await ensureCustomerSession();
        if (cancelled) return;
        if (!session.authenticated) { router.replace("/login?next=%2Fteam"); return; }
        const response = await fetchWithTimeout(`/api/team/members?limit=${PAGE_SIZE}&offset=${offset}`, { credentials: "include", cache: "no-store" });
        if (!response.ok) throw new Error("Members unavailable");
        const data = await response.json() as { members: Member[]; hasMore: boolean };
        if (cancelled) return;
        setMembers(previous => offset === 0 ? (data.members ?? []) : [...previous, ...(data.members ?? [])]);
        setHasMore(data.hasMore === true);
        setError(false);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [offset, router]);

  return (
    <>
      <PageHeader width="wide" eyebrow={t("nav.section.administration")} icon={<Users className="h-4 w-4" />}
        title={t("nav.team")} description={t("team.membersDescription")} />
      <PageContainer width="wide">
        <Card>
          <CardHeader title={t("team.members")} subtitle={t("v4.team.fullAccessBody")} icon={<Users className="h-4 w-4" />} />
          {error && <p role="alert" className="p-5 text-bad">{t("team.loadFailed")}</p>}
          <ul className="divide-y divide-edge-subtle">
            {members.map(member => (
              <li key={member.userId} className="flex items-center justify-between gap-3 p-4">
                <span className="flex min-w-0 items-center gap-3"><Avatar name={member.email} size="sm" />
                  <span className="truncate text-sm font-semibold">{member.email}</span></span>
                <StatusBadge tone="info" label={t("v4.team.fullAccess")} />
              </li>
            ))}
          </ul>
          {loading && <p role="status" className="p-5 text-sm text-ink-3">{t("common.loading")}</p>}
          {!loading && !error && members.length === 0 && <p className="p-5 text-sm text-ink-3">{t("empty.members.description")}</p>}
          {!loading && hasMore && <div className="p-4">
            <Button variant="secondary" onClick={() => { setLoading(true); setOffset(v => v + PAGE_SIZE); }}>{t("common.nextPage")}</Button>
          </div>}
        </Card>
      </PageContainer>
    </>
  );
}
