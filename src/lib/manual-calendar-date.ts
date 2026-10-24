import { intlLocale, type Locale } from '../i18n/config';
import { parseDbTimeMs } from './database-timestamp';
/** Contract date inputs and quota month boundaries are UTC calendar dates. */
export function formatManualCalendarDate(value: Date | string | number | null | undefined, locale: Locale): string | null {
  const ms = typeof value === 'number' ? value : parseDbTimeMs(value);
  if (ms == null || !Number.isFinite(ms)) return null;
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(intlLocale(locale), {dateStyle:'medium',timeZone:'UTC'}).format(date);
}
