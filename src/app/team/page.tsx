"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, Mail, Users } from "lucide-react";
import { useI18n } from "../../i18n/react";
import { ensureCustomerSession } from "../../lib/session-config";
import { fetchWithTimeout } from "../../lib/fetch-timeout";
import { codeMessageKey } from "../../lib/api-error-keys";
import { Avatar, Button, Card, CardHeader, Input, PageContainer, PageHeader, StatusBadge } from "../../components/ui";

type Member = { userId: string; email: string; role: string; platformOwner: boolean };
type Invitation = { id: string; email: string; expiresAt: string };
type Profile = { userId: string; email: string; role: string; platformOwner: boolean; tenant: { id: string } };
type Notice = { kind: "ok" | "err" | "warn"; message: string };
const PAGE_SIZE = 50;

export default function TeamPage() {
  const { t, formatDate } = useI18n();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [memberOffset, setMemberOffset] = useState(0);
  const [inviteOffset, setInviteOffset] = useState(0);
  const [moreMembers, setMoreMembers] = useState(false);
  const [moreInvitations, setMoreInvitations] = useState(false);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await ensureCustomerSession();
        if (cancelled) return;
        if (!session.authenticated) {
          router.replace("/login?next=%2Fteam");
          return;
        }
        const [membersRes, settingsRes] = await Promise.all([
          fetchWithTimeout(`/api/team/members?limit=${PAGE_SIZE}&offset=${memberOffset}`, {
            credentials: "include", cache: "no-store",
          }),
          fetchWithTimeout("/api/settings", {
            credentials: "include", cache: "no-store",
          }),
        ]);
        if (!membersRes.ok || !settingsRes.ok) throw new Error("TEAM_LIST_UNAVAILABLE");
        const [team, account] = await Promise.all([
          membersRes.json() as Promise<{ members: Member[]; hasMore: boolean }>,
          settingsRes.json() as Promise<Profile>,
        ]);
        // Pending invite recipients belong to the owner-only account surface.
        let pending: { invitations: Invitation[]; hasMore: boolean } = { invitations: [], hasMore: false };
        if (account.role === "owner" && !cancelled) {
          const invitesRes = await fetchWithTimeout(`/api/team/invitations?limit=${PAGE_SIZE}&offset=${inviteOffset}`, {
            credentials: "include", cache: "no-store",
          });
          if (!invitesRes.ok) throw new Error("TEAM_INVITATIONS_UNAVAILABLE");
          pending = await invitesRes.json() as { invitations: Invitation[]; hasMore: boolean };
        }
        if (cancelled) return;
        setMembers(team.members ?? []);
        setMoreMembers(team.hasMore === true);
        setInvitations(pending.invitations ?? []);
        setMoreInvitations(pending.hasMore === true);
        setProfile(account);
        setLoadError(false);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [memberOffset, inviteOffset, revision, router]);

  function refresh() {
    setLoading(true);
    setRevision(value => value + 1);
  }

  async function sendInvitation(event: React.FormEvent) {
    event.preventDefault();
    if (profile?.role !== "owner" || busy) return;
    const invitedEmail = email.trim();
    if (!invitedEmail) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetchWithTimeout("/api/team/invitations", {
        method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: invitedEmail }),
      });
      const result = await response.json().catch(() => ({})) as { code?: string };
      if (response.status === 503 && result.code === "INVITATION_DELIVERY_UNAVAILABLE") {
        setNotice({ kind: "warn", message: t("team.deliveryUnconfirmed") });
        setEmail("");
        if (inviteOffset !== 0) setInviteOffset(0);
        else refresh();
        return;
      }
      if (!response.ok) throw new Error(t(codeMessageKey(result.code) ?? "team.invitationFailed"));
      setEmail("");
      setNotice({ kind: "ok", message: t("success.invitationSent") });
      if (inviteOffset !== 0) setInviteOffset(0);
      else refresh();
    } catch (error) {
      setNotice({ kind: "err", message: error instanceof Error ? error.message : t("team.invitationFailed") });
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvitation(id: string) {
    if (profile?.role !== "owner" || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetchWithTimeout(`/api/team/invitations?id=${encodeURIComponent(id)}`, {
        method: "DELETE", credentials: "include", cache: "no-store",
      });
      const result = await response.json().catch(() => ({})) as { code?: string };
      if (!response.ok) throw new Error(t(codeMessageKey(result.code) ?? "team.invitationRevocationFailed"));
      setNotice({ kind: "ok", message: t("success.invitationRevoked") });
      if (invitations.length === 1 && inviteOffset > 0) {
        setLoading(true);
        setInviteOffset(Math.max(0, inviteOffset - PAGE_SIZE));
      } else refresh();
    } catch {
      setNotice({ kind: "err", message: t("team.invitationRevocationFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader width="wide" 
        icon={<Users className="h-4 w-4" />}
        title={t("nav.team")}  />
      <PageContainer width="wide">
        <div className="space-y-5">
          {notice && <p role={notice.kind === "err" ? "alert" : "status"}
            className={`rounded-lg border border-edge p-4 text-sm ${notice.kind === "err" ? "text-bad" : notice.kind === "warn" ? "text-warn" : "text-ok"}`}>
            {notice.message}
          </p>}

          {profile?.role === "owner" && (
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-brand" aria-hidden />
                <h2 className="font-semibold">{t("team.inviteTitle")}</h2>
                <StatusBadge tone="brand" icon={<Crown className="h-3.5 w-3.5 text-warn" aria-hidden />} label={t("team.role.owner")} />
              </div>
              <p className="mt-2 text-sm text-ink-3">{t("team.inviteHint")}</p>
              <form onSubmit={sendInvitation} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="block text-sm">
                  {t("team.inviteEmail")}
                  <Input type="email" required maxLength={320} autoComplete="email"
                    value={email} onChange={e => setEmail(e.target.value)} />
                </label>
                <Button type="submit" variant="primary" loading={busy}
                  disabled={busy || !email.trim()}>
                  {t("team.inviteSubmit")}
                </Button>
              </form>
              <p className="mt-3 text-xs text-ink-3">{t("v4.team.fullAccess")}</p>
            </Card>
          )}

          <div className={profile?.role === "owner" ? "grid items-start gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" : "grid items-start gap-5"}>
            <Card>
              <CardHeader title={t("team.members")} subtitle={t("v4.team.fullAccessBody")}
                icon={<Users className="h-4 w-4" />} />
              {loadError && <p role="alert" className="p-5 text-bad">{t("team.loadMembersFailed")}</p>}
              <ul className="divide-y divide-edge-subtle">
                {members.map(member => (
                  <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={member.email} size="sm" />
                      <span className="min-w-0 break-all text-sm font-semibold">{member.email}</span>
                    </span>
                    <StatusBadge tone={member.role === "owner" ? "brand" : "info"}
                      icon={member.role === "owner" ? <Crown className="h-3.5 w-3.5 text-warn" aria-hidden /> : undefined}
                      label={member.role === "owner" ? t("team.role.owner") : t("v4.team.fullAccess")} />
                  </li>
                ))}
              </ul>
              {loading && <p role="status" className="p-5 text-sm text-ink-3">{t("common.loading")}</p>}
              {!loading && !loadError && members.length === 0 &&
                <p className="p-5 text-sm text-ink-3">{t("empty.members.description")}</p>}
              {!loading && (memberOffset > 0 || moreMembers) &&
                <div className="flex justify-end gap-2 p-4">
                  <Button variant="secondary" disabled={busy || memberOffset === 0}
                    onClick={() => { setLoading(true); setMemberOffset(v => Math.max(0, v - PAGE_SIZE)); }}>
                    {t("common.previousPage")}
                  </Button>
                  <Button variant="secondary" disabled={busy || !moreMembers}
                    onClick={() => { setLoading(true); setMemberOffset(v => v + PAGE_SIZE); }}>
                    {t("common.nextPage")}
                  </Button>
                </div>}
            </Card>
            {profile?.role === "owner" && (
            <Card>
              <CardHeader title={t("team.pendingInvitations")} subtitle={t("team.invitationsHint")}
                icon={<Mail className="h-4 w-4" />} />
              {loadError && <p role="alert" className="p-5 text-bad">{t("team.loadInvitationsFailed")}</p>}
              <ul className="divide-y divide-edge-subtle">
                {invitations.map(invitation => (
                  <li key={invitation.id} className="flex items-center justify-between gap-3 p-4">
                    <span className="min-w-0">
                      <span className="block break-all text-sm font-semibold">{invitation.email}</span>
                      <span className="block text-xs text-ink-3">{formatDate(invitation.expiresAt)}</span>
                    </span>
                    {profile?.role === "owner" && (
                      <Button variant="secondary" size="sm" disabled={busy}
                        onClick={() => void revokeInvitation(invitation.id)}>
                        {t("team.revoke")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {loading && <p role="status" className="p-5 text-sm text-ink-3">{t("common.loading")}</p>}
              {!loading && !loadError && invitations.length === 0 &&
                <p className="p-5 text-sm text-ink-3">{t("team.noInvitations")}</p>}
              {!loading && (inviteOffset > 0 || moreInvitations) &&
                <div className="flex justify-end gap-2 p-4">
                  <Button variant="secondary" disabled={busy || inviteOffset === 0}
                    onClick={() => { setLoading(true); setInviteOffset(v => Math.max(0, v - PAGE_SIZE)); }}>
                    {t("common.previousPage")}
                  </Button>
                  <Button variant="secondary" disabled={busy || !moreInvitations}
                    onClick={() => { setLoading(true); setInviteOffset(v => v + PAGE_SIZE); }}>
                    {t("common.nextPage")}
                  </Button>
                </div>}
            </Card>
            )}
          </div>
        </div>
      </PageContainer>
    </>
  );
}
