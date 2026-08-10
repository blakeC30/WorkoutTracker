import { timingSafeEqual } from 'node:crypto';
import { getEnv } from './env';

/**
 * Compares two secrets without leaking how much of the string matched.
 *
 * A plain `a === b` returns as soon as it hits a differing character, so the time it takes
 * reveals how many leading characters were right. That's a real (if slow) attack on a
 * shared secret. timingSafeEqual always compares the whole buffer.
 */
function secretsMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so check length first — the length of the
  // secret isn't sensitive, only its contents are.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Every MCP tool and API route goes through this before doing anything.
 *
 * Two ways to present the secret, because Claude's connector UI supports different things
 * depending on your account:
 *
 *   1. In the URL path — https://your-backend.vercel.app/api/mcp/<secret>
 *      Works with any MCP client today. This is the one we use.
 *
 *   2. In an Authorization header — `Authorization: Bearer <secret>`
 *      Cleaner (secrets don't belong in URLs), but Claude's request-header auth is still
 *      a gated beta. Supported here so you can switch over without changing code, and so
 *      curl testing is easy.
 */
export function isAuthorized(opts: {
  pathSecret?: string;
  request?: Request;
}): boolean {
  const { API_SECRET } = getEnv();

  if (opts.pathSecret && secretsMatch(opts.pathSecret, API_SECRET)) {
    return true;
  }

  const header = opts.request?.headers.get('authorization');
  if (header) {
    const token = header.startsWith('Bearer ') ? header.slice(7) : header;
    if (secretsMatch(token, API_SECRET)) return true;
  }

  return false;
}

/** A 401 with no detail — never hint at why the secret was rejected. */
export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}
