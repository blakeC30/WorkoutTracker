import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, hasValidSession } from '@/lib/session';

/**
 * Sends anyone without a valid session to /login.
 *
 * `proxy.ts`, not `middleware.ts` — the middleware convention is deprecated in Next 16 and
 * renamed. Same behaviour, different filename and export.
 *
 * THIS IS NOT THE SECURITY BOUNDARY. Next's own guidance is that a proxy check is
 * *optimistic*: it decides what to show, and the real check belongs where the data is read.
 * A matcher is a regex over paths, and the failure mode of a regex is a path nobody thought
 * of. So the enforcing check lives in `lib/backend.ts`, which is the single module that can
 * actually fetch anything — miss a path there and it fetches nothing rather than leaking.
 *
 * What this file buys is the difference between a locked door and a wall: without it an
 * unauthenticated request renders a broken page, and with it you get a login form.
 */
export function proxy(request: NextRequest) {
  if (hasValidSession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';

  // Come back to where you were headed. Only same-site paths — taking a full URL here would
  // make this an open redirect, where a crafted link bounces you to someone else's page after
  // login. A leading-slash check is the whole defence and it is worth having even on a
  // single-user app, because the cost of it is one line.
  const intended = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (intended.startsWith('/') && !intended.startsWith('//') && intended !== '/') {
    url.searchParams.set('next', intended);
  }

  return NextResponse.redirect(url);
}

export const config = {
  /**
   * Everything except the login page itself and the assets that must load without a session.
   *
   * Without a matcher this runs on every request including `_next/static`, which would
   * redirect the stylesheet and the self-hosted fonts to /login and leave you looking at
   * unstyled HTML while being asked to sign in.
   *
   * `icon` and `apple-icon` have NO file extension — they are routes generated from
   * `icon.tsx` and `apple-icon.tsx`, and an earlier version of this list guessed at
   * `icon.png`, which matches neither. The effect was a 307 on the home-screen icon: iOS
   * would have fetched the login page as an image and fallen back to a screenshot of the
   * page. The manifest is public for the same reason — iOS reads it while installing, long
   * before anyone has signed in. It names the app and nothing else.
   */
  matcher: ['/((?!login|icon|apple-icon|manifest\\.webmanifest|favicon\\.ico|_next/static|_next/image).*)'],
};
