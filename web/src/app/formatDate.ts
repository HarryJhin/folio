/**
 * QA-3 P2 #7 — dates were rendering in en-US regardless of the UI language:
 * `new Date(x).toLocaleString()` with no locale argument uses the RUNTIME's
 * default, not the app's, so `8/30/2026, 11:20:59 AM` appeared under
 * `<html lang="uk">` in the trash list, the members dialog and both access
 * admin tabs. The correct pattern was already next door in
 * header/HistoryPanel.tsx (`toLocaleString(i18n.language)`); this is that
 * pattern with a name, so the next date added has somewhere obvious to go.
 *
 * Formats are deliberately the runtime defaults for the locale (no options
 * object): that is what the already-correct call sites produce, and matching
 * them keeps one look across the app rather than introducing a second.
 *
 * Both helpers take the locale explicitly rather than reading i18next
 * themselves — callers already hold it (`const { t, i18n } =
 * useTranslation('app')`), and passing it keeps these pure and testable.
 */

function parse(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Date + time of day, e.g. `30.08.2026, 11:20:59` for uk. Empty string for an unparseable value. */
export function formatDateTime(value: string | number | Date, locale: string): string {
  return parse(value)?.toLocaleString(locale) ?? '';
}

/** Date only, e.g. `30.08.2026` for uk. Empty string for an unparseable value. */
export function formatDate(value: string | number | Date, locale: string): string {
  return parse(value)?.toLocaleDateString(locale) ?? '';
}

const fieldFormats = new Map<string, Intl.DateTimeFormat>();

/** A calendar date or floating wall time keeps its own fields. Only an instant is converted to the viewer's time zone. */
export function formatCalendarValue(value: string, locale: string, unzonedTime: 'wall' | 'utc' = 'wall'): string {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(value);
  if (!match) return value;
  const [, day, clock, offset] = match;
  const calendar = new Date(day);
  if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day) return value;
  const date = clock ? new Date(`${day}T${clock}${offset || 'Z'}`) : calendar;
  if (Number.isNaN(date.getTime())) return value;
  const fixedFields = !clock || (!offset && unzonedTime === 'wall');
  const key = `${locale}:${clock ? 'time' : 'day'}:${fixedFields ? 'UTC' : 'local'}`;
  let formatter = fieldFormats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: clock ? 'short' : undefined,
      timeZone: fixedFields ? 'UTC' : undefined,
    });
    fieldFormats.set(key, formatter);
  }
  return formatter.format(date);
}
