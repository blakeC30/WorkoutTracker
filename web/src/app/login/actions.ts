'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, createSessionToken, verifyPassword } from '@/lib/session';
import { clearFailures, isLockedOut, minutesUntilUnlocked, recordFailure } from '@/lib/rate-limit';

/**
 * Who is attempting this, for rate-limiting purposes only.
 *
 * `x-forwarded-for` is a client-supplied header and is trivially spoofed — but on Vercel the
 * proxy appends the real peer address as the LAST entry, and anything a client wrote sits to
 * the left of it. Taking the last entry means a forged header adds noise it cannot use to
 * escape its own bucket. Taking the first, which is the usual habit, would let an attacker
 * pick a new identity per request and make the limiter ornamental.
 */
async function callerKey(): Promise<string> {
  const forwarded = (await headers()).get('x-forwarded-for');
  if (!forwarded) return 'unknown';
  const hops = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
  return hops[hops.length - 1] ?? 'unknown';
}

/**
 * Only same-site paths. Without this check, `?next=https://elsewhere.example` turns the login
 * form into an open redirect — a link that authenticates you and then lands you somewhere
 * chosen by whoever sent the link.
 */
function safeNext(next: string | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

export async function signIn(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  const next = safeNext(String(formData.get('next') ?? '') || undefined);

  const caller = await callerKey();
  const suffix = next === '/' ? '' : `&next=${encodeURIComponent(next)}`;

  // Before verifyPassword, not after. scrypt is deliberately expensive, so refusing a
  // locked-out caller has to happen while refusing is still cheap — otherwise the limiter
  // caps how often someone can *succeed* while doing nothing about what they cost.
  if (isLockedOut(caller)) {
    redirect(`/login?error=rate&wait=${minutesUntilUnlocked(caller)}${suffix}`);
  }

  if (!verifyPassword(password)) {
    recordFailure(caller);
    // A pause on top of the cap. Slow enough that grinding shows up as a visible pattern in
    // the logs rather than as silent background traffic.
    await new Promise((resolve) => setTimeout(resolve, 500));
    redirect(`/login?error=1${suffix}`);
  }

  clearFailures(caller);

  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    // Not readable from JavaScript, so Safari does not treat it as script-writable storage
    // and does not expire it after seven idle days. See lib/session.ts.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  redirect(next);
}

export async function signOut() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  redirect('/login');
}
