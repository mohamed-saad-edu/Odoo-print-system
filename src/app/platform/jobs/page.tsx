"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Clock3, History, Printer, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, PageHeader, StatusBadge, TableSkeleton, type Tone } from "../../../components/ui";
import { fetchWithTimeout } from "../../../lib/fetch-timeout";
import { useI18n } from "../../../i18n/react";

const LIMIT = 40;
type PrintRecord = {
  id: string; tenantId: string; tenantName: string | null; printerId: string; printerName: string | null;
  agentId: string; agentName: string | null; destination: string | null; documentType: string | null;
  status: string; error: string | null; createdAt: string; updatedAt: string; archived: boolean;
  physicalOutcome: "printed" | "not_printed" | "unknown";
};
const labels = {
  en: { title: "Print operations", eyebrow: "Gateway / Operations", description: "Live queue and durable receipts across every workspace. Historical records carry metadata, not print payloads.", all: "All states", active: "In progress", success: "Submitted", failed: "Failed", expired: "Expired", unknown: "Uncertain outcome", search: "Find job / destination / workspace", tenant: "Workspace ID (optional)", refresh: "Refresh", workspace: "Workspace", job: "Job / document", destination: "Device / agent", state: "Gateway outcome", seen: "Created", archived: "Archived receipt", live: "Live queue", paper: "Paper output unverified", empty: "No matching print operations", emptyBody: "Adjust your filters or choose another workspace.", fail: "Couldn't load Gateway print history.", newer: "Previous", older: "Next", audit: "Audit trail", records: "records on this page", privacy: "Print payloads and credentials are never included in this view.", operator: "A successful Gateway submission is not independent proof of physical paper output." },
  ar: { title: "عمليات الطباعة", eyebrow: "الجيتواي / العمليات", description: "الطابور الحالي والسجلات المحفوظة لكل مساحات العمل. السجل التاريخي بدون محتوى الملفات المطبوعة.", all: "كل الحالات", active: "قيد التنفيذ", success: "تم التسليم للجهاز", failed: "فشل", expired: "منتهية", unknown: "نتيجة غير مؤكدة", search: "بحث برقم المهمة أو الوجهة أو العميل", tenant: "معرّف العميل (اختياري)", refresh: "تحديث", workspace: "مساحة العمل", job: "المهمة / النوع", destination: "الطابعة / الأيجنت", state: "حالة الجيتواي", seen: "تاريخ الإنشاء", archived: "سجل مؤرشف", live: "نشط", paper: "خروج الورق غير مؤكد", empty: "مفيش مهام مطابقة", emptyBody: "غيّر الفلاتر أو اختر عميلًا آخر.", fail: "تعذر تحميل تاريخ مهام الطباعة.", newer: "السابق", older: "التالي", audit: "سجل التدقيق", records: "مهمة في الصفحة", privacy: "لا تُعرض ملفات الطباعة أو بيانات الدخول هنا.", operator: "تأكيد التسليم من الجيتواي لا يثبت خروج الورق فعليًا." },
} as const;
function tone(status: string): Tone { return status === "success" ? "ok" : status === "failed" ? "bad" : status === "expired" ? "warn" : status === "queued" ? "info" : "neutral"; }

export default function PlatformPrintOperationsPage() {
  const { locale, formatDateTime, formatNumber } = useI18n();
  const t = labels[locale];
  const [records, setRecords] = useState<PrintRecord[]>([]);
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [tenant, setTenant] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [reload, setReload] = useState(0);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const search = query.trim();
  const key = JSON.stringify([status, search, tenant.trim(), offset, reload]);
  const loading = loadedKey !== key;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function load() {
      if (search.length === 1) { setRecords([]); setHasMore(false); setLoadedKey(key); return; }
      const qs = new URLSearchParams({ status, limit: String(LIMIT), offset: String(offset) });
      if (search) qs.set("search", search);
      if (tenant.trim()) qs.set("tenantId", tenant.trim());
      try {
        const response = await fetchWithTimeout(`/api/platform/jobs?${qs}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw Error(String(response.status));
        const data = await response.json() as { jobs?: PrintRecord[]; hasMore?: boolean };
        if (cancelled) return;
        setRecords(Array.isArray(data.jobs) ? data.jobs : []);
        setHasMore(data.hasMore === true);
        setRefreshedAt(new Date().toISOString());
        setError("");
      } catch { if (!cancelled) { setError(t.fail); setRecords([]); setHasMore(false); } }
      finally { if (!cancelled) setLoadedKey(key); }
    }
    void load();
    return () => { cancelled = true; controller.abort(); };
  }, [key, status, search, tenant, offset, t.fail]);

  const stateChoices = ["all", "active", "success", "failed", "expired", "unknown"] as const;
  return (
    <div className="space-y-5 pb-10">
      <PageHeader title={t.title} eyebrow={t.eyebrow} icon={<History className="h-5 w-5" />} description={t.description} actions={<Button variant="secondary" size="sm" onClick={() => setReload(v => v + 1)} icon={<RefreshCw className="h-4 w-4" />}>{t.refresh}</Button>} />
      <div className="rounded-xl border border-edge bg-surface px-5 py-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <label className="relative block text-sm text-ink-3"><Search className="absolute left-3 top-3 h-4 w-4 rtl:left-auto rtl:right-3" aria-hidden /><span className="sr-only">{t.search}</span><input value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} maxLength={64} placeholder={t.search} className="h-11 w-full rounded-lg border border-edge bg-surface-2 ps-10 pe-3 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/25" /></label>
          <label className="block"><span className="sr-only">{t.tenant}</span><input value={tenant} maxLength={120} onChange={e => { setTenant(e.target.value); setOffset(0); }} placeholder={t.tenant} className="h-11 w-full rounded-lg border border-edge bg-surface-2 px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/25" /></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label={locale === "ar" ? "فلترة الحالة" : "State filters"}>
          {stateChoices.map(value => <button type="button" key={value} aria-pressed={status === value} onClick={() => {setStatus(value);setOffset(0);}} className={`min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-brand ${status === value ? "border-brand bg-brand-subtle text-brand" : "border-edge bg-surface text-ink-3 hover:bg-surface-2"}`}>{t[value]}</button>)}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3"><span className="inline-flex gap-2"><ShieldCheck className="h-4 w-4 text-ok" aria-hidden />{t.privacy}</span><span>{refreshedAt && !loading ? formatDateTime(refreshedAt) : ""}</span></div>
      {error && <ErrorState title={t.fail} message={error} retry={() => setReload(v => v + 1)} />}
      {!error && <Card className="overflow-hidden">
        <div className="overflow-x-auto"><table className="data-table min-w-[820px]"><caption className="sr-only">{t.title}</caption><thead><tr><th scope="col">{t.job}</th><th scope="col">{t.workspace}</th><th scope="col">{t.destination}</th><th scope="col">{t.state}</th><th scope="col">{t.seen}</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={5}><TableSkeleton rows={5} /></td></tr> : records.length === 0 ? <tr><td colSpan={5}><EmptyState title={t.empty} description={search.length === 1 ? (locale === "ar" ? "اكتب حرفين على الأقل" : "Enter at least two characters") : t.emptyBody} icon={<Clock3 className="h-5 w-5" />} /></td></tr> : records.map(job => (
            <tr key={`${job.tenantId}-${job.id}`}>
              <td><div className="font-mono text-xs font-semibold text-ink" dir="ltr">{job.id}</div><div className="mt-1 text-xs text-ink-3">{job.documentType || "—"} · {job.destination || "—"}</div><div className="mt-1"><StatusBadge size="sm" tone={job.archived ? "info" : "neutral"} label={job.archived ? t.archived : t.live} /></div></td>
              <td><div className="text-sm font-semibold text-ink">{job.tenantName || job.tenantId}</div><div className="font-mono text-xs text-ink-4" dir="ltr">{job.tenantId}</div></td>
              <td><div className="inline-flex items-center gap-2 text-sm text-ink"><Printer className="h-4 w-4 text-brand" aria-hidden />{job.printerName || job.printerId}</div><div className="text-xs text-ink-3">{job.agentName || job.agentId}</div></td>
              <td><StatusBadge tone={tone(job.status)} label={job.status} size="sm" />{job.status === "success" && <div className="mt-1 text-xs text-ink-3">{t.paper}</div>}{job.error && <div title={job.error} className="mt-1 max-w-[230px] truncate text-xs text-bad">{job.error}</div>}</td>
              <td className="text-xs text-ink-3">{formatDateTime(job.createdAt)}</td>
            </tr>))}</tbody></table></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-4 py-3 text-xs text-ink-3"><span>{formatNumber(records.length)} {t.records}</span><div className="flex gap-2"><Button size="xs" variant="secondary" disabled={loading || offset === 0} onClick={() => setOffset(x => Math.max(0, x-LIMIT))}>{locale === "ar" ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}{t.newer}</Button><Button size="xs" variant="secondary" disabled={loading || !hasMore} onClick={() => setOffset(x => x+LIMIT)}>{t.older}{locale === "ar" ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}</Button></div></div>
      </Card>}
      <p className="rounded-lg border border-edge bg-surface-2 p-3 text-sm text-ink-3">{t.operator} <Link href="/platform/audit" className="font-semibold text-brand underline underline-offset-4">{t.audit}</Link></p>
    </div>
  );
}
