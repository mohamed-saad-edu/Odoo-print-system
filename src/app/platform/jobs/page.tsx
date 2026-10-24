"use client";

import { FileOutputDetails } from "../../../components/PrinterVerificationDetails";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Clock3, Eye, History, Printer, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { Button, Card, EmptyState, ErrorState, Modal, PageHeader, StatusBadge, TableSkeleton } from "../../../components/ui";
import { fetchWithTimeout } from "../../../lib/fetch-timeout";
import { useI18n } from "../../../i18n/react";
import { deriveOutcome, jobFailurePresentation, jobGuidance, jobDisplayLabel, jobTone, type PhysicalOutcome } from "../../../shared/job-vocabulary";

const LIMIT = 40;
type PrintRecord = {
  outputMedium?: string;
  outputEvidence?: Record<string, unknown> | null;
  id: string; tenantId: string; tenantName: string | null; printerId: string; printerName: string | null;
  agentId: string; agentName: string | null; destination: string | null; documentType: string | null;
  status: string; error: string | null; createdAt: string; updatedAt: string; archived: boolean;
  retries: number | null; deliveryAttempts: number | null; requestedBy: string | null;
  claimedAt: string | null; deliveredAt: string | null; ackedAt: string | null; expiresAt: string | null;
  physicalOutcome: "printed" | "not_printed" | "unknown";
};
const labels = {
  en: { title: "Print operations", eyebrow: "Gateway / Operations", description: "Live queue and durable receipts across every workspace. Historical records carry metadata, not print payloads.", all: "All states", active: "In progress", success: "Submitted", failed: "Failed", expired: "Expired", unknown: "Uncertain outcome", search: "Find job / destination / workspace", tenant: "Workspace ID (optional)", refresh: "Refresh", workspace: "Workspace", job: "Job / document", destination: "Device / agent", state: "Gateway outcome", seen: "Created", archived: "Archived receipt", live: "Live queue", paper: "Paper output unverified", empty: "No matching print operations", emptyBody: "Adjust your filters or choose another workspace.", fail: "Couldn't load Gateway print history.", newer: "Previous", older: "Next", audit: "Audit trail", records: "records on this page", privacy: "Print payloads and credentials are never included in this view.", operator: "A successful Gateway submission is not independent proof of physical paper output.", details: "Job diagnostics", detailAction: "Inspect details", attempts: "Delivery attempts", retries: "Retries", submittedBy: "Requested by", lastUpdate: "Last updated", claimed: "Claimed", delivered: "Delivered", acknowledged: "Acknowledged", expires: "Expires", physical: "Physical outcome", printed: "Confirmed paper output", notPrinted: "Not printed", errorDetail: "Last recorded error", unavailable: "Not recorded" },
  ar: { title: "عمليات الطباعة", eyebrow: "الجيتواي / العمليات", description: "الطابور الحالي والسجلات المحفوظة لكل مساحات العمل. السجل التاريخي بدون محتوى الملفات المطبوعة.", all: "كل الحالات", active: "قيد التنفيذ", success: "تم التسليم للجهاز", failed: "فشل", expired: "منتهية", unknown: "نتيجة غير مؤكدة", search: "بحث برقم المهمة أو الوجهة أو العميل", tenant: "معرّف العميل (اختياري)", refresh: "تحديث", workspace: "مساحة العمل", job: "المهمة / النوع", destination: "الطابعة / الأيجنت", state: "حالة الجيتواي", seen: "تاريخ الإنشاء", archived: "سجل مؤرشف", live: "نشط", paper: "خروج الورق غير مؤكد", empty: "مفيش مهام مطابقة", emptyBody: "غيّر الفلاتر أو اختر عميلًا آخر.", fail: "تعذر تحميل تاريخ مهام الطباعة.", newer: "السابق", older: "التالي", audit: "سجل التدقيق", records: "مهمة في الصفحة", privacy: "لا تُعرض ملفات الطباعة أو بيانات الدخول هنا.", operator: "تأكيد التسليم من الجيتواي لا يثبت خروج الورق فعليًا.", details: "تفاصيل المهمة وتشخيصها", detailAction: "عرض التفاصيل", attempts: "محاولات التسليم", retries: "إعادة المحاولة", submittedBy: "طلب الطباعة", lastUpdate: "آخر تحديث", claimed: "استلام المهمة", delivered: "تسليم المهمة", acknowledged: "تأكيد الاستلام", expires: "انتهاء الصلاحية", physical: "النتيجة الفعلية", printed: "خروج الورق مؤكد", notPrinted: "لم تتم الطباعة", errorDetail: "آخر خطأ مسجل", unavailable: "غير مسجل" },
} as const;
function outcome(job: PrintRecord): PhysicalOutcome { return job.physicalOutcome ?? deriveOutcome(job.status, job.error); }

export default function PlatformPrintOperationsPage() {
  const { locale, formatDateTime, formatNumber } = useI18n();
  const t = labels[locale];
  const [records, setRecords] = useState<PrintRecord[]>([]);
  const [selectedJob, setSelectedJob] = useState<PrintRecord | null>(null);
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
      if (search.length === 1) { setRecords([]); setHasMore(false); setError(""); setLoadedKey(key); return; }
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
      <PageHeader title={t.title} eyebrow={t.eyebrow} icon={<History className="h-5 w-5" />} description={t.description} actions={<Button variant="secondary" size="sm" loading={loading} onClick={() => setReload(v => v + 1)} icon={<RefreshCw className="h-4 w-4" />}>{t.refresh}</Button>} />
      <div className="rounded-xl border border-edge bg-surface px-5 py-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <label className="relative block text-sm text-ink-3"><Search className="absolute left-3 top-3 h-4 w-4 rtl:left-auto rtl:right-3" aria-hidden /><span className="sr-only">{t.search}</span><input value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} maxLength={64} placeholder={t.search} className="h-11 w-full rounded-lg border border-edge bg-surface-2 ps-10 pe-3 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/25" /></label>
          <label className="block"><span className="sr-only">{t.tenant}</span><input value={tenant} maxLength={120} onChange={e => { setTenant(e.target.value); setOffset(0); }} placeholder={t.tenant} className="h-11 w-full rounded-lg border border-edge bg-surface-2 px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/25" /></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label={locale === "ar" ? "فلترة الحالة" : "State filters"}>
          {stateChoices.map(value => <button type="button" key={value} aria-pressed={status === value} onClick={() => {setStatus(value);setOffset(0);}} className={`min-h-11 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-brand ${status === value ? "border-brand bg-brand-subtle text-brand" : "border-edge bg-surface text-ink-3 hover:bg-surface-2"}`}>{t[value]}</button>)}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3"><span className="inline-flex gap-2"><ShieldCheck className="h-4 w-4 text-ok" aria-hidden />{t.privacy}</span><span>{refreshedAt && !loading ? formatDateTime(refreshedAt) : ""}</span></div>
      {error && <ErrorState title={t.fail} message={error} retry={() => setReload(v => v + 1)} />}
      {!error && <Card className="overflow-hidden">
        <div className="overflow-x-auto" aria-busy={loading}><table role="table" className="data-table operational-table md:min-w-[820px]"><caption className="sr-only">{t.title}</caption><thead><tr><th scope="col">{t.job}</th><th scope="col">{t.workspace}</th><th scope="col">{t.destination}</th><th scope="col">{t.state}</th><th scope="col">{t.seen}</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={5}><TableSkeleton rows={5} /></td></tr> : records.length === 0 ? <tr><td colSpan={5}><EmptyState title={t.empty} description={search.length === 1 ? (locale === "ar" ? "اكتب حرفين على الأقل" : "Enter at least two characters") : t.emptyBody} icon={<Clock3 className="h-5 w-5" />} /></td></tr> : records.map(job => (
            <tr key={`${job.tenantId}-${job.id}`}>
              <td><div className="font-mono text-xs font-semibold text-ink" dir="ltr">{job.id}</div><div className="mt-1 text-xs text-ink-3">{job.documentType || "—"} · {job.destination || "—"}</div><div className="mt-1"><StatusBadge size="sm" tone={job.archived ? "info" : "neutral"} label={job.archived ? t.archived : t.live} /></div>
                <div className="mt-2"><Button size="xs" variant="secondary" onClick={() => setSelectedJob(job)} icon={<Eye className="h-3.5 w-3.5" />}>{t.detailAction}</Button></div></td>
              <td><span className="data-table-label" aria-hidden>{t.workspace}</span><div className="text-sm font-semibold text-ink">{job.tenantName || job.tenantId}</div><div className="font-mono text-xs text-ink-4" dir="ltr">{job.tenantId}</div></td>
              <td><span className="data-table-label" aria-hidden>{t.destination}</span><div className="inline-flex items-center gap-2 text-sm text-ink"><Printer className="h-4 w-4 text-brand" aria-hidden />{job.printerName || job.printerId}</div><div className="text-xs text-ink-3">{job.agentName || job.agentId}</div></td>
              <td><span className="data-table-label" aria-hidden>{t.state}</span><StatusBadge tone={jobTone(job.status, outcome(job))} label={jobDisplayLabel(job.status, job.error, locale, job)} size="sm" />{job.error && <div className="mt-1 max-w-[280px] text-xs text-ink-3">{jobFailurePresentation(job.error, locale)?.title ?? (jobGuidance(job.status, outcome(job), locale) || t.errorDetail)}</div>}</td>
              <td className="text-xs text-ink-3"><span className="data-table-label" aria-hidden>{t.seen}</span>{formatDateTime(job.createdAt)}</td>
            </tr>))}</tbody></table></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-edge px-4 py-3 text-xs text-ink-3"><span>{formatNumber(records.length)} {t.records}</span><div className="flex gap-2"><Button size="xs" variant="secondary" disabled={loading || offset === 0} onClick={() => setOffset(x => Math.max(0, x-LIMIT))}>{locale === "ar" ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}{t.newer}</Button><Button size="xs" variant="secondary" disabled={loading || !hasMore} onClick={() => setOffset(x => x+LIMIT)}>{t.older}{locale === "ar" ? <ArrowLeft className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}</Button></div></div>
      </Card>}
      <Modal open={selectedJob !== null} onClose={() => setSelectedJob(null)} title={t.details} description={selectedJob?.outputMedium === "file" ? (locale === "ar" ? "إخراج ملف PDF" : "PDF file output") : t.operator} wide>
        {selectedJob && (
          <div className="space-y-5 text-sm text-ink-2">
            <div className="rounded-lg border border-edge bg-surface-2 p-4">
              <p className="font-mono text-xs text-ink" dir="ltr">{selectedJob.id}</p>
              <p className="mt-2 text-xs text-ink-3">{selectedJob.tenantName || selectedJob.tenantId} · {selectedJob.archived ? t.archived : t.live}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3"><StatusBadge tone={jobTone(selectedJob.status, outcome(selectedJob))} label={jobDisplayLabel(selectedJob.status, selectedJob.error, locale, selectedJob)} size="sm" />
                <FileOutputDetails job={selectedJob} />{selectedJob.outputMedium !== "file" && <span className="font-medium text-ink-3">{t.physical}: {outcome(selectedJob) === "printed" ? t.printed : outcome(selectedJob) === "not_printed" ? t.notPrinted : t.paper}</span>}</div>
            </div>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {([
                [t.destination, selectedJob.destination || t.unavailable],
                [t.submittedBy, selectedJob.requestedBy || t.unavailable],
                [t.attempts, selectedJob.deliveryAttempts == null ? t.unavailable : formatNumber(selectedJob.deliveryAttempts)],
                [t.retries, selectedJob.retries == null ? t.unavailable : formatNumber(selectedJob.retries)],
                [t.seen, formatDateTime(selectedJob.createdAt)],
                [t.lastUpdate, formatDateTime(selectedJob.updatedAt)],
                [t.claimed, selectedJob.claimedAt ? formatDateTime(selectedJob.claimedAt) : t.unavailable],
                [t.delivered, selectedJob.deliveredAt ? formatDateTime(selectedJob.deliveredAt) : t.unavailable],
                [t.acknowledged, selectedJob.ackedAt ? formatDateTime(selectedJob.ackedAt) : t.unavailable],
                [t.expires, selectedJob.expiresAt ? formatDateTime(selectedJob.expiresAt) : t.unavailable],
              ] as [string, string][]).map(([name, value]) => <div key={name} className="min-w-0 rounded-lg border border-edge px-3 py-2"><dt className="text-xs text-ink-3">{name}</dt><dd className="mt-1 break-words font-medium text-ink">{value}</dd></div>)}
            </dl>
            {selectedJob.error && <div className="rounded-lg border border-bad-edge bg-bad-bg p-3"><p className="font-semibold text-bad">{t.errorDetail}</p><p className="mt-1 break-words text-xs text-ink-2">{selectedJob.error}</p></div>}
            <p className="text-xs text-ink-3">{t.privacy} {t.operator}</p>
          </div>
        )}
      </Modal>
      <p className="rounded-lg border border-edge bg-surface-2 p-3 text-sm text-ink-3">{t.operator} <Link href="/platform/audit" className="font-semibold text-brand underline underline-offset-4">{t.audit}</Link></p>
    </div>
  );
}
