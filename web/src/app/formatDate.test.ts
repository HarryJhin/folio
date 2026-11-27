/**
 * QA-3 P2 #7 — `toLocaleString()` with no argument formats in the RUNTIME's
 * locale, not the app's, so `8/30/2026, 11:20:59 AM` was appearing under
 * `<html lang="uk">` in the trash list, the members dialog and both access
 * admin tabs. These pin that the locale actually reaches Intl, and that a
 * bad timestamp renders as nothing rather than the string "Invalid Date".
 */
import { describe, expect, it } from 'vitest';
import { formatCalendarValue, formatDate, formatDateTime } from './formatDate';

const AT = '2026-08-30T08:20:59.000Z';

// Derived from the same instant rather than hard-coded, so these assertions
// hold in whatever timezone the suite happens to run in.
const local = new Date(AT);
const pad = (n: number) => String(n).padStart(2, '0');
const UK_DATE = `${pad(local.getDate())}.${pad(local.getMonth() + 1)}.${local.getFullYear()}`;
const US_DATE = `${local.getMonth() + 1}/${local.getDate()}/${local.getFullYear()}`;

describe('formatDateTime', () => {
  it('formats in the requested locale, not the runtime default', () => {
    const uk = formatDateTime(AT, 'uk');
    const en = formatDateTime(AT, 'en-US');
    expect(uk).not.toBe(en);
    // uk is day-first and 24-hour; en-US is month-first with AM/PM.
    expect(uk.startsWith(UK_DATE)).toBe(true);
    expect(uk).not.toMatch(/AM|PM/);
    expect(en.startsWith(US_DATE)).toBe(true);
  });

  it('formats en too (both UI languages are wired)', () => {
    expect(formatDateTime(AT, 'en')).toContain(US_DATE);
  });

  it('accepts a Date, an ISO string, and an epoch number alike', () => {
    const expected = formatDateTime(AT, 'uk');
    expect(formatDateTime(new Date(AT), 'uk')).toBe(expected);
    expect(formatDateTime(Date.parse(AT), 'uk')).toBe(expected);
  });

  it('renders an unparseable value as empty, not as "Invalid Date"', () => {
    expect(formatDateTime('not a date', 'uk')).toBe('');
    expect(formatDateTime('', 'uk')).toBe('');
  });
});

describe('formatDate', () => {
  it('drops the time of day but keeps the locale', () => {
    expect(formatDate(AT, 'uk')).toBe(UK_DATE);
    expect(formatDate(AT, 'en-US')).toBe(US_DATE);
  });

  it('renders an unparseable value as empty', () => {
    expect(formatDate('nope', 'uk')).toBe('');
  });
});

describe('Korean calendar fields', () => {
  it('keeps date-only and floating wall times in their original calendar day', () => {
    expect(formatCalendarValue('2026-11-27', 'ko')).toBe('2026. 11. 27.');
    const wall = new Intl.DateTimeFormat('ko', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
    for (const time of ['2026-11-27T15:05', '2026-11-27T00:01', '2026-03-08T02:30']) {
      expect(formatCalendarValue(time, 'ko')).toBe(wall.format(new Date(time + 'Z')));
    }
    expect(formatCalendarValue('pending', 'ko')).toBe('pending');
  });

  it('shows explicitly zoned instants in the reader’s time zone', () => {
    const iso = '2026-11-27T00:30:00+09:00';
    const expected = new Intl.DateTimeFormat('ko', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
    expect(formatCalendarValue(iso, 'ko')).toBe(expected);
  });
});
