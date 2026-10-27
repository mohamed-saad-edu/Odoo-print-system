import { intlLocale, type Locale } from "../i18n/config";

export type PlanCurrency = "USD" | "SAR";

/** A configured catalog price is descriptive, not proof of a paid invoice. */
export function formatPlanPrice(
  minorUnits: number | null | undefined,
  currency: string | null | undefined,
  locale: Locale,
): string | null {
  if (minorUnits == null || !Number.isSafeInteger(minorUnits) || minorUnits < 0) return null;
  if (currency !== "USD" && currency !== "SAR") return null;
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(minorUnits / 100);
}
