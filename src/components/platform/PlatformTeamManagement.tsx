"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n/react";
import { Crown } from "lucide-react";
import { adminJson, controlClass, useAdminText } from "./ManualAdmin";
import { Button, Card } from "../ui";

type Row = Record<string, string | number | boolean | null>;
type Invitation = { id: string; email: string; expiresAt: string };
type Mutation = { kind: "remove" | "transfer"; userId: string; email: string };

export function PlatformTeamManagement({ tenantId, members, onChanged }: {
  tenantId: string; members: Row[]; onChanged: () => void;
}) {
  const { t } = useI18n();
  const { a, formatDate } = useAdminText();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmation, setConfirmation] = useState<Mutation | null>(null);
  const base = `/api/platform/tenants/${encodeURIComponent(tenantId)}`;

  const refresh = useCallback(async () => {
    const result = await adminJson(`${base}/invitations`) as { invitations: Invitation[] };
    setInvitations(result.invitations ?? []);
  }, [base]);
  useEffect(() => { let active = true; adminJson(`${base}/invitations`)
    .then((result: { invitations: Invitation[] }) => { if (active) setInvitations(result.invitations ?? []); })
    .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [base]);

  async function withPlatformProof(action: () => Promise<void>) {
    if (!password || busy) return;
    setBusy(true); setError(false); setSaved(false);
    const proof = password;
    setPassword("");
    try {
      await adminJson("/api/platform/auth/reauth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: proof }),
      });
      await action();
      await refresh();
      onChanged();
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setConfirmation(null);
      setBusy(false);
    }
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    const inviteEmail = email.trim();
    await withPlatformProof(async () => {
      await adminJson(`${base}/invitations`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });
      setEmail("");
    });
  }

  async function revoke(id: string) {
    await withPlatformProof(async () => {
      await adminJson(`${base}/invitations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    });
  }

  async function mutateMember() {
    const request = confirmation;
    if (!request) return;
    await withPlatformProof(async () => {
      if (request.kind === "transfer") {
        await adminJson(`${base}/ownership`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: request.userId }),
        });
      } else {
        await adminJson(`${base}/members?userId=${encodeURIComponent(request.userId)}`, { method: "DELETE" });
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">{t("team.inviteTitle")}</h2>
        <form onSubmit={invite} className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">{t("team.inviteEmail")}
            <input className={controlClass} type="email" required value={email}
              onChange={event => setEmail(event.target.value)} maxLength={320} />
          </label>
          <label className="block text-sm">{a("password")}
            <input className={controlClass} type="password" autoComplete="current-password"
              required value={password} onChange={event => setPassword(event.target.value)} />
          </label>
          <Button disabled={busy || !email || !password} loading={busy} type="submit">{t("team.inviteSubmit")}</Button>
        </form>
        <p className="text-sm text-ink-3">{t("v4.team.fullAccess")}</p>
        {error && <p role="alert" className="text-bad">{a("saveError")}</p>}
        {saved && <p role="status" className="text-ok">{a("saved")}</p>}
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold">{t("team.members")}</h2>
        <ul className="mt-3 divide-y divide-edge-subtle">
          {members.map(member => {
            const id = String(member.id ?? "");
            const isOwner = member.role === "owner";
            return <li key={id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="break-all font-semibold">{String(member.email ?? "")}</p>
                <p className="flex items-center gap-1.5 text-sm text-ink-3">{member.isPlatformOwner === true
                  ? <><Crown className="h-3.5 w-3.5 text-warn" aria-hidden />{t("team.role.owner")}</>
                  : t("v4.team.fullAccess")}</p>
              </div>
              {!isOwner && <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" disabled={busy}
                  onClick={() => setConfirmation({kind:"transfer",userId:id,email:String(member.email)})}>
                  {t("team.transferOwnership")}
                </Button>
                <Button variant="danger" size="sm" disabled={busy}
                  onClick={() => setConfirmation({kind:"remove",userId:id,email:String(member.email)})}>
                  {t("team.removeFromWorkspace")}
                </Button>
              </div>}
            </li>;
          })}
        </ul>
        {confirmation && <div className="mt-4 rounded-lg border border-edge p-4">
          <p className="break-all">{confirmation.email} · {confirmation.kind === "transfer"
            ? t("team.transferOwnership") : t("team.removeFromWorkspace")}</p>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={() => setConfirmation(null)}>{t("common.cancel")}</Button>
            <Button variant="danger" disabled={!password || busy} loading={busy} onClick={() => void mutateMember()}>
              {t("common.confirm")}
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-3">{a("password")}</p>
        </div>}
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold">{t("team.pendingInvitations")}</h2>
        <ul className="mt-3 divide-y divide-edge-subtle">
          {invitations.map(invitation => <li key={invitation.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div><p className="break-all">{invitation.email}</p>
              <p className="text-xs text-ink-3">{formatDate(invitation.expiresAt)}</p></div>
            <Button variant="secondary" size="sm" disabled={busy || !password}
              onClick={() => void revoke(invitation.id)}>{t("team.revoke")}</Button>
          </li>)}
        </ul>
      </Card>
    </div>
  );
}
