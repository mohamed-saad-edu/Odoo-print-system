import { intlLocale, type Locale } from "../i18n/config";

export type PlanCurrency = "USD" | "SAR";

/** Shared catalog input contract for the Platform Owner form and backend.
 * No floating-point rounding, exponential notation or silent truncation. */
export function parsePlanPriceAmount(amount: string): number | null {
  if (typeof amount !== "string") return null;
  const matched = /^(0|[1-9][0-9]{0,9})(?:\.([0-9]{1,2}))?$/.exec(amount);
  if (!matched) return null;
  const minorUnits = Number(matched[1]) * 100 + Number((matched[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(minorUnits) && minorUnits <= 2_147_483_647 ? minorUnits : null;
}

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

/**
 * Pricing cards keep the amount and ISO currency code on separate visual tiers.
 * The LTR amount + code pair is stable in Arabic while decimal separators stay
 * locale-aware. Do not append a monthly term: plan prices are not billing cycles.
 */
export function formatPlanPriceDisplay(
  minorUnits: number | null | undefined,
  currency: string | null | undefined,
  locale: Locale,
): { amount: string; currency: PlanCurrency } | null {
  if (minorUnits == null || !Number.isSafeInteger(minorUnits) || minorUnits < 0) return null;
  if (currency !== "USD" && currency !== "SAR") return null;
  return {
    amount: new Intl.NumberFormat(intlLocale(locale), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(minorUnits / 100),
    currency,
  };
}
