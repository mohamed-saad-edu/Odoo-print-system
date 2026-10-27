import type { Translator } from "../i18n/translate";
import type { MessageKey } from "../i18n/messages/en";

/** Localized billing interval for display. Unknown values fall back to the
 * raw enum (display-only, never a billing decision). */
export function billingIntervalLabel(value: string | null | undefined, t: Translator): string {
  const key = (value ?? "").trim().toLowerCase();
  if (key === "month" || key === "year" || key === "week" || key === "day") {
    return t(`platform.plans.interval.${key}` as MessageKey);
  }
  return key || "—";
}

/** Localized manual subscription term for customer & platform views. */
export function billingTermLabel(value: string | null | undefined, t: Translator): string {
  const key = (value ?? "").trim().toLowerCase();
  if (key === "yearly") return t("v4.onboarding.yearly");
  if (key === "custom") return t("v4.subscription.custom");
  if (key === "monthly") return t("v4.onboarding.monthly");
  return t("v4.subscription.notSet");
}
