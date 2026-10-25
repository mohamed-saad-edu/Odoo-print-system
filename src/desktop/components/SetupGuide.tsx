import React from "react";
import { CheckCircle2, KeyRound, Printer, RefreshCw } from "lucide-react";
import { Button, Card, Field, Input, StatusBadge } from "../../components/ui";
import { useI18n } from "../../i18n/react";
import type { DesktopState } from "../types";
import { isMainInventoryPrinter, printerPresentation } from "../lib/printers";

/** Progress comes from authenticated replies and current verified inventory.
 * Public Gateway health and a running local service never prove pairing. */
export function SetupGuide({ s }: { s: DesktopState }) {
  const { t } = useI18n();
  const ready = s.printers.filter(isMainInventoryPrinter).some((p) => printerPresentation(p, undefined, s.nowMs).state === "ready");
  const steps = [
    { title: "v4.experience.setup.gateway", body: "v4.experience.setup.gatewayBody", complete: s.gatewayConnected, action: () => s.navigate("settings") },
    { title: "v4.experience.setup.pair", body: "v4.experience.setup.pairBody", complete: s.pairingConfirmed, action: () => s.navigate("settings") },
    { title: "v4.experience.setup.discover", body: "v4.experience.setup.discoverBody", complete: s.printers.some(isMainInventoryPrinter), action: () => s.navigate("printers") },
    { title: "v4.experience.setup.verify", body: "v4.experience.setup.verifyBody", complete: ready, action: () => s.navigate("printers") },
  ] as const;
  const active = steps.findIndex((step) => !step.complete);
  return <Card className="p-5 sm:p-6">
    <details open={active !== -1}>
      <summary className="cursor-pointer text-lg font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/35">{t("v4.experience.setup.title")}</summary>
      <p className="mt-2 text-sm leading-relaxed text-ink-3">{t("v4.experience.setup.body")}</p>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => <li key={step.title} className={`flex min-w-0 flex-col gap-3 rounded-xl border p-4 ${index === active ? "border-edge-accent bg-brand-subtle" : "border-edge bg-surface-2"}`}>
          <div className="flex items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-edge bg-surface text-sm font-bold">{step.complete ? <CheckCircle2 className="h-4 w-4 text-ok" aria-hidden /> : index + 1}</span><h3 className="text-sm font-semibold text-ink">{t(step.title)}</h3></div>
          <p className="flex-1 text-sm leading-relaxed text-ink-3">{t(step.body)}</p>
          <StatusBadge tone={step.complete ? "ok" : "neutral"} label={t(step.complete ? "v4.experience.setup.done" : "v4.experience.setup.pending")} />
          <Button variant={index === active ? "primary" : "secondary"} onClick={step.action}>{t("v4.experience.setup.open")}</Button>
        </li>)}
      </ol>
      {s.gatewayConnected && !s.pairingConfirmed && <form className="mt-5 flex flex-wrap items-end gap-3 rounded-lg border border-edge p-4" onSubmit={(e) => { e.preventDefault(); if (!s.busy && /^[A-Z0-9]{6}$/.test(s.pairCode)) s.pair(); }}>
        <Field label={t("desktop.settings.pairCodeLabel")} htmlFor="home-pair-code"><Input id="home-pair-code" dir="ltr" autoComplete="off" maxLength={6} value={s.pairCode} onChange={(e) => s.setPairCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} className="font-mono tracking-widest" /></Field>
        <Button type="submit" variant="primary" loading={s.busy} disabled={!/^[A-Z0-9]{6}$/.test(s.pairCode)} icon={<KeyRound className="h-4 w-4" />}>{t("desktop.settings.pair")}</Button>
      </form>}
      {s.pairingConfirmed && !ready && <div className="mt-4 flex flex-wrap gap-3"><Button variant="primary" onClick={s.handleDiscover} disabled={s.busy} icon={<RefreshCw className="h-4 w-4" />}>{t("desktop.printers.discover")}</Button><Button variant="secondary" onClick={() => s.navigate("printers")} icon={<Printer className="h-4 w-4" />}>{t("v4.experience.printers.verify")}</Button></div>}
    </details>
  </Card>;
}
