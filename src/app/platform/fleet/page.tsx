"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Cpu, LockKeyhole, Printer, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Field, Modal, PageHeader, StatusBadge, TableSkeleton, Textarea, type Tone } from "../../../components/ui";
import { fetchWithTimeout } from "../../../lib/fetch-timeout";
import { useI18n } from "../../../i18n/react";

const LIMIT = 40;
type FleetItem = { id: string; tenantId: string; tenantName: string; name: string; lifecycle: string; status: string; lastSeenAt: string | null; createdAt: string; agentId?: string; agentName?: string | null; protocol?: string | null; inventoryPresent?: boolean; sharedWithGateway?: boolean; };
const strings = {
  en: { title: "Fleet control", eyebrow: "Gateway / Fleet", desc: "Workspace-scoped inventory and authorized lifecycle actions. Live observation is distinct from administrative state.", agents: "Agents", printers: "Printers", all: "All lifecycles", active: "Active", disabled: "Disabled", retired: "Retired", search: "Search inventory / workspace", workspace: "Workspace ID (optional)", inventory: "Inventory", node: "Device", owner: "Workspace", health: "Observed", life: "Lifecycle", last: "Last seen", action: "Action", refreshed: "Refresh", empty: "No matching fleet devices", error: "Fleet inventory unavailable", reason: "Reason for change (minimum 5 characters)", close: "Cancel", confirm: "Apply change", confirmTitle: "Confirm a live fleet lifecycle change", explanation: "This writes to the Gateway database and audit trail. Disabling an Agent revokes its credentials and prevents work; enabling it requires a new one-time pairing code.", pairing: "One-time pairing code", pairingHelp: "Provide this code securely to the Agent operator. It is only visible in this dialog and expires after 10 minutes.", notice: "Change saved. Fleet inventory was refreshed.", audit: "Audit history", prev: "Previous", next: "Next", notNow: "No observation", warning: "Enablement also checks the workspace subscription and Agent availability." },
  ar: { title: "التحكم في الأجهزة", eyebrow: "الجيتواي / الأجهزة", desc: "كل الأيجنت والطابعات للعملاء مع تحكم موثق في دورة حياتها. الحالة التشغيلية مختلفة عن الحالة الإدارية.", agents: "الأيجنت", printers: "الطابعات", all: "كل الحالات", active: "نشط", disabled: "معطل", retired: "متوقف نهائيًا", search: "بحث عن جهاز أو عميل", workspace: "معرّف العميل (اختياري)", inventory: "قائمة الأجهزة", node: "الجهاز", owner: "العميل", health: "الحالة المرصودة", life: "الحالة الإدارية", last: "آخر اتصال", action: "الإجراء", refreshed: "تحديث", empty: "لا توجد أجهزة مطابقة", error: "تعذر تحميل الأجهزة", reason: "سبب التغيير (5 أحرف على الأقل)", close: "إلغاء", confirm: "تأكيد التغيير", confirmTitle: "تأكيد إجراء حقيقي على أجهزة الجيتواي", explanation: "الإجراء بيسجل في قاعدة البيانات وسجل التدقيق. تعطيل الأيجنت يلغي بيانات الاتصال؛ تفعيله بيحتاج كود ربط جديد يُعرض مرة واحدة.", pairing: "كود الربط لمرة واحدة", pairingHelp: "سلّم الكود لمشغل الأيجنت بأمان. يظهر في النافذة دي فقط وينتهي خلال 10 دقائق.", notice: "تم تسجيل التغيير وتحديث قائمة الأجهزة.", audit: "سجل التدقيق", prev: "السابق", next: "التالي", notNow: "لا يوجد اتصال مؤكد", warning: "إعادة التفعيل بتتحقق من الاشتراك وحالة الأيجنت المرتبط." },
} as const;
const lifecycleTone = (status: string): Tone => status === "active" ? "ok" : status === "disabled" ? "warn" : "neutral";
const healthTone = (status: string): Tone => status === "online" ? "ok" : status === "busy" ? "info" : status === "error" ? "bad" : "warn";

export default function PlatformFleetPage() {
  const { locale, formatDateTime, formatNumber } = useI18n();
  const t = strings[locale];
  const [kind, setKind] = useState<"agents" | "printers">("agents");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [tenant, setTenant] = useState("");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loadedKey, setLoadedKey] = useState("");
  const [items, setItems] = useState<FleetItem[]>([]);
  const [observedAt, setObservedAt] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<FleetItem | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [acting, setActing] = useState(false);
  const [pairing, setPairing] = useState("");
  const query = search.trim();
  const key = JSON.stringify([kind, status, query, tenant.trim(), offset, refresh]);
  const loading = loadedKey !== key;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function load() {
      if (query.length === 1) { setItems([]); setHasMore(false); setLoadedKey(key); return; }
      const params = new URLSearchParams({ kind, status, limit: String(LIMIT), offset: String(offset) });
      if (query) params.set("search", query);
      if (tenant.trim()) params.set("tenantId", tenant.trim());
      try {
        const res = await fetchWithTimeout(`/api/platform/fleet?${params}`, {cache:"no-store", signal: controller.signal});
        if (!res.ok) throw Error(String(res.status));
        const data = await res.json() as { items?: FleetItem[]; hasMore?: boolean; observedAt?: string };
        if (cancelled) return;
        setItems(Array.isArray(data.items) ? data.items : []);
        setObservedAt(typeof data.observedAt === "string" ? data.observedAt : null);
        setHasMore(data.hasMore === true);
        setError("");
      } catch { if (!cancelled) { setError(t.error); setItems([]); setHasMore(false); } }
      finally { if (!cancelled) setLoadedKey(key); }
    }
    void load();
    return () => { cancelled = true; controller.abort(); };
  }, [key, kind, status, query, tenant, offset, t.error]);

  async function applyLifecycle() {
    if (!selected || acting || reason.trim().length < 5) return;
    setActing(true); setActionError("");
    const nextLifecycle = selected.lifecycle === "active" ? "disabled" : "active";
    try {
      const response = await fetchWithTimeout("/api/platform/fleet/lifecycle", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ kind, tenantId: selected.tenantId, id: selected.id, expectedLifecycle: selected.lifecycle, nextLifecycle, reason: reason.trim() }),
      });
      const data = await response.json().catch(() => null) as { error?: string; pairingCode?: string | null } | null;
      if (!response.ok) throw Error(data?.error || String(response.status));
      setNotice(t.notice);
      setRefresh(x => x + 1);
      setPairing(data?.pairingCode || "");
      if (!data?.pairingCode) { setSelected(null); setReason(""); }
    } catch (e) { setActionError(e instanceof Error ? e.message : t.error); }
    finally { setActing(false); }
  }
  const choices = ["all", "active", "disabled", "retired"] as const;
  return <div className="space-y-5 pb-10">
    <PageHeader title={t.title} eyebrow={t.eyebrow} icon={<Cpu className="h-5 w-5" />} description={t.desc} actions={<Button size="sm" onClick={() => setRefresh(x => x+1)} icon={<RefreshCw className="h-4 w-4" />}>{t.refreshed}</Button>} />
    <div className="rounded-xl border border-edge bg-surface px-5 py-4 shadow-sm">
      <div role="tablist" aria-label={t.inventory} className="mb-4 inline-flex gap-1 rounded-xl border border-edge bg-surface-2 p-1">
        {(["agents", "printers"] as const).map(x => <button key={x} type="button" role="tab" aria-selected={kind === x} onClick={() => {setKind(x);setOffset(0);setStatus("all");}} className={`min-h-10 rounded-lg px-5 text-sm font-semibold ${kind === x ? "bg-surface text-brand shadow-sm" : "text-ink-3 hover:bg-surface"}`}>{x === "agents" ? t.agents : t.printers}</button>)}
      </div>
      <div className="grid gap-3 md:grid-cols-[2fr_1fr]"><label className="relative"><Search className="absolute top-3 left-3 h-4 w-4 text-ink-3 rtl:left-auto rtl:right-3" aria-hidden /><span className="sr-only">{t.search}</span><input value={search} maxLength={64} onChange={e=>{setSearch(e.target.value);setOffset(0);}} placeholder={t.search} className="h-11 w-full rounded-lg border border-edge bg-surface-2 ps-10 pe-3 text-sm text-ink" /></label><label><span className="sr-only">{t.workspace}</span><input value={tenant} maxLength={120} onChange={e=>{setTenant(e.target.value);setOffset(0);}} placeholder={t.workspace} className="h-11 w-full rounded-lg border border-edge bg-surface-2 px-3 text-sm text-ink" /></label></div>
      <div className="mt-4 flex flex-wrap gap-2">{choices.map(x => <button type="button" key={x} aria-pressed={status===x} onClick={()=>{setStatus(x);setOffset(0);}} className={`min-h-9 rounded-full border px-3 text-xs font-semibold ${status===x ? "border-brand bg-brand-subtle text-brand" : "border-edge text-ink-3 hover:bg-surface-2"}`}>{t[x]}</button>)}</div>
    </div>
    {notice && <div role="status" className="rounded-lg border border-ok-edge bg-ok-bg p-3 text-sm text-ok">{notice}</div>}
    {error && <ErrorState title={t.error} message={error} retry={()=>setRefresh(x=>x+1)} />}
    {!error && <Card className="overflow-hidden"><div className="overflow-x-auto"><table className="data-table min-w-[780px]"><caption className="sr-only">{t.inventory}</caption><thead><tr><th>{t.node}</th><th>{t.owner}</th><th>{t.health}</th><th>{t.life}</th><th>{t.last}</th><th>{t.action}</th></tr></thead><tbody>{loading ? <tr><td colSpan={6}><TableSkeleton rows={5} /></td></tr> : items.length===0 ? <tr><td colSpan={6}><EmptyState title={t.empty} icon={<AlertCircle className="h-5 w-5" />} /></td></tr> : items.map(device => <tr key={`${device.tenantId}-${device.id}`}>
      <td><div className="flex items-center gap-2 font-semibold text-ink">{kind==="agents" ? <Cpu className="h-4 w-4 text-brand" /> : <Printer className="h-4 w-4 text-brand" />}{device.name}</div><div className="mt-1 font-mono text-xs text-ink-4" dir="ltr">{device.id}</div>{kind==="printers" && <><div className="mt-1 text-xs text-ink-3">{device.protocol || device.agentName || device.agentId || "—"}</div>{device.sharedWithGateway === false && <div className="mt-1 text-xs font-semibold text-warn">{locale === "ar" ? "صاحب الطابعة منع المشاركة مع الجيتواي" : "Local owner has not shared with Gateway"}</div>}</>}</td>
      <td><div className="text-sm text-ink">{device.tenantName}</div><div className="font-mono text-xs text-ink-4" dir="ltr">{device.tenantId}</div></td>
      <td><StatusBadge size="sm" tone={healthTone(device.status)} label={device.status} /></td>
      <td><StatusBadge size="sm" tone={lifecycleTone(device.lifecycle)} label={device.lifecycle} /></td>
      <td className="text-xs text-ink-3">{device.lastSeenAt ? formatDateTime(device.lastSeenAt) : t.notNow}</td>
      <td>{device.lifecycle !== "retired" && <Button size="xs" variant={device.lifecycle === "active" ? "danger" : "secondary"} onClick={()=>{setSelected(device);setReason("");setActionError("");setPairing("");}}>{device.lifecycle === "active" ? t.disabled : t.active}</Button>}</td>
    </tr>)}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-2 border-t border-edge p-4 text-xs text-ink-3"><span>{formatNumber(items.length)} {t.inventory}{observedAt ? ` · ${formatDateTime(observedAt)}` : ""}</span><div className="flex gap-2"><Button size="xs" disabled={loading||offset===0} onClick={()=>setOffset(x=>Math.max(0,x-LIMIT))}>{t.prev}</Button><Button size="xs" disabled={loading||!hasMore} onClick={()=>setOffset(x=>x+LIMIT)}>{t.next}</Button></div></div></Card>}
    <div className="flex items-start gap-2 rounded-lg border border-edge bg-surface-2 p-3 text-sm text-ink-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden /><p>{t.warning} <Link href="/platform/audit" className="font-semibold text-brand underline underline-offset-4">{t.audit}</Link></p></div>
    <Modal open={selected!==null} onClose={()=>{if(!acting){setSelected(null);setPairing("");setReason("");}}} title={pairing ? t.pairing : t.confirmTitle} description={pairing ? t.pairingHelp : t.explanation} footer={pairing ? <Button onClick={()=>{setSelected(null);setPairing("");setReason("");}}>{t.close}</Button> : <><Button disabled={acting} variant="secondary" onClick={()=>setSelected(null)}>{t.close}</Button><Button disabled={acting||reason.trim().length<5} loading={acting} variant={selected?.lifecycle === "active" ? "danger" : "primary"} onClick={()=>void applyLifecycle()}>{t.confirm}</Button></>}>
      {pairing ? <div className="rounded-xl border border-edge-accent bg-brand-subtle p-4"><div className="flex gap-2 text-sm font-semibold text-brand"><LockKeyhole className="h-4 w-4" />{t.pairing}</div><code className="mt-3 block select-all text-center font-mono text-2xl tracking-widest text-ink" dir="ltr">{pairing}</code><p className="mt-3 text-xs text-ink-3">{t.pairingHelp}</p></div> : <><p className="mb-4 text-sm text-ink-2">{selected?.name} · {selected?.tenantName}</p><Field label={t.reason} htmlFor="lifecycle-reason"><Textarea id="lifecycle-reason" value={reason} onChange={e=>setReason(e.target.value)} maxLength={300} rows={3} /></Field>{actionError && <p role="alert" className="mt-3 text-sm text-bad">{actionError}</p>}</>}
    </Modal>
  </div>;
}
