/**
 * Date and number formatting. Safe to import from Client Components — no secrets here.
 */

import { todayInAppTz } from './time';

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

/**
 * Seconds as '8:42' — a pace or a duration reads wrong as '8.7'.
 *
 * Takes SECONDS now, not minutes, along with everything else that carries a duration. It used
 * to do the minutes-to-mm:ss arithmetic itself; the database stores whole seconds, so the
 * conversion is a divide and a remainder rather than a fractional part.
 */
export function clock(seconds: number | null): string {
  if (seconds === null) return '—';
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * A duration in the unit a person would say it in.
 *
 * Under two minutes reads as seconds, because that is a hold — "45s", not "0:45". At or above
 * it reads mm:ss, because that is a run, and "2400s" is a number nobody converts in their head.
 * One helper so the threshold cannot differ between the two screens that show durations.
 */
export function duration(seconds: number | null): string {
  if (seconds === null) return '—';
  return seconds < 120 ? `${Math.round(seconds)}s` : clock(seconds);
}

/** How many days ago, in the app's timezone. Used to grey out stale rows. */
export function daysAgo(iso: string): number {
  const then = parseDay(iso);
  return Math.round((parseDay(todayInAppTz()).getTime() - then.getTime()) / 86_400_000);
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 'YYYY-MM-DD' for a local Date. `toISOString()` would give UTC and shift the day. */
export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Today, in the app's timezone — NOT the timezone of whatever machine is running this.
 *
 * These pages render on Vercel, where that machine is in UTC and is already on tomorrow for
 * the last five hours of every Central day. See `./time`.
 */
export function today(): string {
  return todayInAppTz();
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
