/**
 * Date and number formatting. Safe to import from Client Components — no secrets here.
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * Parse a 'YYYY-MM-DD' from the backend into a LOCAL date.
 *
 * `new Date('2026-08-11')` parses as UTC midnight, which in Central is 7pm on the 10th — so
 * every date renders one day early for anyone west of Greenwich. Splitting the parts and using
 * the local constructor is the fix. This bug has already been paid for once in this project.
 */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 'MON 11 AUG' */
export function dayLabel(iso: string): string {
  const d = parseDay(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** '11 AUG' */
export function shortDay(iso: string): string {
  const d = parseDay(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** ISO week number, for the header. */
export function isoWeek(d: Date): number {
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // Thursday of this week determines the year the week belongs to.
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

/** Whole number with thousands separators: 83265 -> '83,265'. */
export function int(value: number | null): string {
  if (value === null) return '—';
  return Math.round(value).toLocaleString('en-US');
}

/** Fixed decimals, trailing zeros kept so a column of weights stays aligned. */
export function dec(value: number | null, places = 1): string {
  if (value === null) return '—';
  return value.toFixed(places);
}

/** Compact volume for tight rows: 83265 -> '83.3k'. */
export function compact(value: number | null): string {
  if (value === null) return '—';
  if (Math.abs(value) < 1000) return String(Math.round(value));
  return `${(value / 1000).toFixed(Math.abs(value) < 10_000 ? 1 : 0)}k`;
}

/** Minutes as '8:42' — a pace or a duration reads wrong as '8.7'. */
export function clock(minutes: number | null): string {
  if (minutes === null) return '—';
  const whole = Math.floor(minutes);
  const seconds = Math.round((minutes - whole) * 60);
  return `${whole}:${String(seconds).padStart(2, '0')}`;
}

/** How many days ago, in the phone's timezone. Used to grey out stale rows. */
export function daysAgo(iso: string): number {
  const then = parseDay(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - then.getTime()) / 86_400_000);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 'YYYY-MM-DD' for a local Date. `toISOString()` would give UTC and shift the day. */
export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today, in the phone's own timezone. */
export function today(): string {
  return toIso(new Date());
}

/** Shifts a 'YYYY-MM-DD' by whole days, staying in local time. */
export function addDays(iso: string, delta: number): string {
  const d = parseDay(iso);
  d.setDate(d.getDate() + delta);
  return toIso(d);
}

/**
 * A month, as the pieces a grid needs.
 *
 * Weeks start on **Monday**, matching the rest of the app: Postgres `date_trunc('week')` is
 * Monday-based and the Week screen counts ISO weeks, so a Sunday-first calendar here would put
 * a different boundary on the same data two taps apart.
 */
export function monthShape(key: string) {
  const [year, month] = key.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const days = new Date(year, month, 0).getDate();
  return {
    year,
    month,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    short: `${MONTH_NAMES[month - 1].slice(0, 3).toUpperCase()}`,
    days,
    /** Blank squares before the 1st. getDay() is Sunday-based, so Monday has to become 0. */
    leading: (first.getDay() + 6) % 7,
    from: `${key}-01`,
    to: `${key}-${String(days).padStart(2, '0')}`,
  };
}

/** 'YYYY-MM' for a date string, and neighbouring months for the pager. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split('-').map(Number);
  const d = new Date(year, month - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function agoLabel(iso: string): string {
  const days = daysAgo(iso);
  if (days <= 0) return 'TODAY';
  if (days === 1) return 'YESTERDAY';
  if (days < 7) return `${days}D AGO`;
  if (days < 56) return `${Math.floor(days / 7)}W AGO`;
  return `${Math.floor(days / 30)}MO AGO`;
}
