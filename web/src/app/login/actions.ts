'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, createSessionToken, verifyPassword } from '@/lib/session';

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

  if (!verifyPassword(password)) {
    // A fixed pause on failure. This is friction, not a rate limiter — Vercel runs many
    // instances and none of them share memory, so there is nowhere to keep a counter that
    // every attempt would pass through. The actual defence is that `auth:setup` generates a
    // password with far too much entropy to guess, and this makes grinding it slow enough to
    // be visible in the logs rather than silent.
    await new Promise((resolve) => setTimeout(resolve, 500));
    redirect(`/login?error=1${next === '/' ? '' : `&next=${encodeURIComponent(next)}`}`);
  }

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
