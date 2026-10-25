import { describe, expect, it } from 'vitest';
import { formatManualCalendarDate } from '../src/lib/manual-calendar-date';
describe('manual contract and monthly quota calendar display',()=>{
  it('retains the UTC first-day reset independently of host/browser timezone',()=>{
    expect(formatManualCalendarDate('2026-11-01T00:00:00.000Z','en')).toBe('Nov 1, 2026');
    expect(formatManualCalendarDate('2026-11-01 00:00:00','en')).toBe('Nov 1, 2026');
    expect(formatManualCalendarDate(new Date('2026-11-01T00:00:00Z'),'en')).toBe('Nov 1, 2026');
    expect(formatManualCalendarDate(Date.parse('2026-11-01T00:00:00Z'),'en')).toBe('Nov 1, 2026');
  });
  it('matches editor dates in both supported locales',()=>{
    expect(formatManualCalendarDate('2027-10-24T00:00:00Z','en')).toBe('Oct 24, 2027');
    expect(formatManualCalendarDate('2027-10-24T00:00:00Z','ar')).toBe(new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{dateStyle:'medium',timeZone:'UTC'}).format(new Date('2027-10-24T00:00:00Z')));
  });
  it('does not fabricate dates for unavailable values',()=>{
    expect(formatManualCalendarDate(null,'en')).toBeNull();
    expect(formatManualCalendarDate('invalid','en')).toBeNull();
    expect(formatManualCalendarDate(1e99,'en')).toBeNull();
    expect(formatManualCalendarDate(NaN,'en')).toBeNull();
    expect(formatManualCalendarDate(new Date(NaN),'en')).toBeNull();
  });
});
