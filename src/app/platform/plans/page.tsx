"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, PageHeader } from "../../../components/ui";
import { adminJson, controlClass } from "../../../components/platform/ManualAdmin";
import type { ManualPlan } from "../../../components/platform/SubscriptionEditor";
import { formatPlanPrice, parsePlanPriceAmount } from "../../../lib/plan-price";
import { useI18n } from "../../../i18n/react";
import type { MessageKey } from "../../../i18n/messages/en";

const empty = {
  id: "",
  name: "",
  description: "",
  monthlyQuota: 1000,
  priceAmount: "",
  priceCurrency: "USD" as "USD" | "SAR",
  isActive: true,
  isPublic: true,
  displayOrder: 0,
};

export default function Plans() {
  const { t, locale, formatNumber } = useI18n();
  const [plans, setPlans] = useState<ManualPlan[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    adminJson("/api/platform/plans")
      .then((d) => { if (live) setPlans(d.plans); })
      .catch(() => { if (live) { setPlans([]); setError(t("v4.admin.loadError")); } });
    return () => { live = false; };
  }, [tick, t]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!preview) return;
    setBusy(true);
    try {
      await adminJson("/api/platform/plans" + (editing ? `/${encodeURIComponent(editing)}` : ""), {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": preview },
        body: JSON.stringify({
          ...form,
          priceAmount: form.priceAmount === "" ? null : form.priceAmount,
          priceCurrency: form.priceAmount === "" ? null : form.priceCurrency,
        }),
      });
      setOpen(false);
      setPreview(null);
      setTick((x) => x + 1);
      setError("");
    } catch {
      setError(t("v4.admin.saveError"));
    } finally {
      setBusy(false);
    }
  }

  function edit(p?: ManualPlan) {
    setForm(p ? {
      id: p.id,
      name: p.name,
      description: p.description,
      monthlyQuota: Number(p.entitlements.max_prints_per_period),
      priceAmount: p.priceMinorUnits == null ? "" : (p.priceMinorUnits / 100).toFixed(2),
      priceCurrency: p.priceCurrency === "SAR" ? "SAR" : "USD",
      isActive: p.isActive,
      isPublic: p.isPublic,
      displayOrder: p.displayOrder,
    } : empty);
    setEditing(p?.id ?? null);
    setPreview(null);
    setOpen(true);
    setError("");
  }

  return (
    <div className="space-y-5">
      <PageHeader
        variant="inline"
        title={t("v4.admin.plansTitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link className="rounded-lg border border-edge px-4 py-2" href="/platform/subscriptions">
              {t("v4.admin.overviewLink")}
            </Link>
            <Button onClick={() => edit()}>{t("v4.admin.newPlan")}</Button>
          </div>
        }
      />
      {error && <p role="alert" className="text-bad">{error}</p>}
      {open && (
        <Card className="p-5">
          <h2 className="mb-4 text-xl font-semibold">
            {t(`v4.admin.${editing ? "editPlan" : "newPlan"}` as MessageKey)}
          </h2>
          {preview ? (
            <form onSubmit={save} className="space-y-4">
              <p>{form.name} · {formatNumber(form.monthlyQuota)} {t("v4.admin.quota")} · {form.priceAmount ? form.priceAmount + " " + form.priceCurrency : t("v4.admin.priceOnRequest")}</p>
              <div className="flex gap-3">
                <Button type="submit" disabled={busy} loading={busy}>{t("v4.admin.confirm")}</Button>
                <Button type="button" variant="secondary" onClick={() => setPreview(null)}>{t("v4.admin.cancel")}</Button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (form.priceAmount !== "" && parsePlanPriceAmount(form.priceAmount) === null) {
                  setError(t("v4.admin.priceInvalid"));
                  return;
                }
                setError("");
                setPreview(crypto.randomUUID());
              }}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {(["id", "name", "description", "monthlyQuota", "displayOrder"] as const).map((k) => (
                  <label key={k} className="block text-sm">
                    {t(`v4.admin.${({ id: "planId", monthlyQuota: "quota", displayOrder: "order" } as Record<string, string>)[k] ?? k}` as MessageKey)}
                    <input
                      className={controlClass}
                      required={k !== "description"}
                      disabled={k === "id" && !!editing}
                      type={k === "monthlyQuota" || k === "displayOrder" ? "number" : "text"}
                      min={k === "monthlyQuota" ? 1 : 0}
                      max={k === "monthlyQuota" ? 2147483647 : k === "displayOrder" ? 1000000 : undefined}
                      maxLength={k === "description" ? 500 : k === "id" ? 64 : 120}
                      pattern={k === "id" ? "[a-z0-9][a-z0-9_-]{1,63}" : undefined}
                      value={form[k]}
                      onChange={(e) => setForm((f) => ({ ...f, [k]: k === "monthlyQuota" || k === "displayOrder" ? Number(e.target.value) : e.target.value }))}
                    />
                  </label>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm">
                  {t("v4.admin.priceAmount")}
                  <input
                    className={controlClass}
                    type="text"
                    inputMode="decimal"
                    pattern="(?:0|[1-9][0-9]{0,9})(?:[.][0-9]{1,2})?"
                    maxLength={13}
                    placeholder="0.00"
                    value={form.priceAmount}
                    onChange={(e) => setForm((f) => ({ ...f, priceAmount: e.target.value }))}
                  />
                </label>
                <label className="block text-sm">
                  {t("v4.admin.priceCurrency")}
                  <select
                    className={controlClass}
                    value={form.priceCurrency}
                    onChange={(e) => setForm((f) => ({ ...f, priceCurrency: e.target.value as "USD" | "SAR" }))}
                  >
                    <option value="USD">USD</option>
                    <option value="SAR">SAR</option>
                  </select>
                </label>
              </div>
              {(["isActive", "isPublic"] as const).map((k) => (
                <label key={k} className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form[k]}
                    onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.checked }))}
                  />
                  {t(`v4.admin.${k === "isActive" ? "enabled" : "public"}` as MessageKey)}
                </label>
              ))}
              <Button type="submit">{t("v4.admin.preview")}</Button>
            </form>
          )}
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id} className="p-5">
            <h2 className="text-lg font-semibold">{p.name}</h2>
            <p className="mt-2 text-sm text-ink-3">{p.description}</p>
            <p className="mt-5 text-3xl font-semibold">
              {p.entitlements.max_prints_per_period === "unlimited" ? t("v4.admin.unlimited") : formatNumber(Number(p.entitlements.max_prints_per_period))}
            </p>
            <p className="mb-4 text-sm text-ink-3">{t("v4.admin.quota")}</p>
            <p className="mb-4 font-semibold">
              <bdi dir="auto">{formatPlanPrice(p.priceMinorUnits, p.priceCurrency, locale) ?? t("v4.admin.priceOnRequest")}</bdi>
            </p>
            <Button variant="secondary" onClick={() => edit(p)}>{t("v4.admin.editPlan")}</Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
