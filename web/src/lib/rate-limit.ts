/**
 * A cap on how often one address may attempt a login.
 *
 * BE CLEAR ABOUT WHAT THIS IS FOR. It is not what stops someone guessing the password —
 * `auth:setup` generates 24 characters from a 55-character alphabet, which is not going to
 * fall to guessing at any rate this could permit. Two other things make it worth having:
 *
 *   1. COST. Every attempt runs scrypt, which is memory-hard and slow *by design*. That is
 *      the right property for storing a password and a terrible one to expose to an
 *      unlimited number of anonymous requests: each guess costs the attacker one HTTP
 *      request and costs this account real function time. The lock is checked BEFORE the
 *      hash is computed, so a locked-out caller is cheap to refuse.
 *   2. THE ESCAPE HATCH. `npm run auth:setup -- "my own phrase"` exists, and a passphrase
 *      someone chose by hand is a different security proposition from a generated one. This
 *      is the layer that covers that decision.
 *
 * AND BE CLEAR ABOUT WHAT IT IS NOT. The state below is a module-level Map, so it lives in
 * one serverless instance's memory. Vercel runs many, and an attacker spreading requests
 * across them gets a fresh allowance from each; a deploy or a cold start empties it entirely.
 * Making this airtight means shared state — Vercel KV, Upstash, a table in Postgres reached
 * through the backend — and that is a service to configure, pay for and keep alive in
 * exchange for hardening a door whose key is already 139 bits. The honest trade is to take
 * the cheap 90% and write down which 10% is missing, rather than to imply a guarantee.
 */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 8;

// Bounded so a flood of distinct addresses cannot grow this without limit. Well above the
// number of addresses one person's phone and laptop will ever present.
const MAX_TRACKED = 5_000;

const failures = new Map<string, number[]>();

function recent(key: string, now: number): number[] {
  const times = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length === 0) failures.delete(key);
  else failures.set(key, times);
  return times;
}

/** True when this caller has spent its allowance. Check before doing any expensive work. */
export function isLockedOut(key: string, now = Date.now()): boolean {
  return recent(key, now).length >= MAX_FAILURES;
}

export function recordFailure(key: string, now = Date.now()): void {
  if (failures.size > MAX_TRACKED && !failures.has(key)) {
    // Full, and this is a new key. Drop the oldest tracked entry rather than refusing to
    // track — the alternative silently stops limiting exactly when it matters most.
    const oldest = failures.keys().next();
    if (!oldest.done) failures.delete(oldest.value);
  }
  failures.set(key, [...recent(key, now), now]);
}

/** A successful login clears the record, so a typo streak doesn't linger. */
export function clearFailures(key: string): void {
  failures.delete(key);
}

/** How long until this caller may try again, in whole minutes (for the message). */
export function minutesUntilUnlocked(key: string, now = Date.now()): number {
  const times = recent(key, now);
  if (times.length < MAX_FAILURES) return 0;
  return Math.max(1, Math.ceil((WINDOW_MS - (now - times[0])) / 60_000));
}
