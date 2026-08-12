/**
 * The timezone this log is kept in. Mirrors `backend/src/lib/time.ts` — duplicated on
 * purpose, since the two apps share no build tooling. If you move, change both.
 *
 * The backend stamps every `entry_date` as a calendar day in this zone. So "today" here is
 * not the phone's today and not the server's today: it is whichever day the backend would
 * file a row under right now. Anything else and the two disagree about which row is today's.
 *
 * That disagreement is what this file exists to prevent, and it is not hypothetical. These
 * pages are `force-dynamic`, so they render on Vercel, where the process timezone is UTC.
 * `new Date()` in a Server Component is therefore UTC — and after 7pm Central, UTC has
 * already rolled over. The dashboard spent that window showing tomorrow's date in the
 * masthead, highlighting tomorrow on the calendar, and finding no nutrition row for a
 * "today" that had not started yet.
 *
 * Reading `new Date()` and hoping is what breaks. Both helpers below go through Intl with an
 * explicit `timeZone`, which is correct no matter where the code runs — Vercel, a laptop, or
 * the browser.
 */
export const APP_TIMEZONE = 'America/Chicago';

// Built once. Intl formatters are comparatively expensive to construct and these run on
// every render.
const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  // h23 rather than hour12:false — the latter is allowed to render midnight as "24", which
  // would push the date forward by a day at exactly the hour this bug is about.
  hourCycle: 'h23',
});

function partsOf(instant: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of PARTS.formatToParts(instant)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out;
}

/**
 * A Date whose LOCAL getters read the app timezone's wall clock.
 *
 * For the formatting helpers, which all use `getFullYear`/`getMonth`/`getDate`. The instant
 * it represents is meaningless — only the fields are — so never compare it to a real Date or
 * send it anywhere.
 */
export function nowInAppTz(): Date {
  const p = partsOf(new Date());
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** 'YYYY-MM-DD' for right now in the app timezone. Matches the backend's `entry_date`. */
export function todayInAppTz(): string {
  const p = partsOf(new Date());
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
