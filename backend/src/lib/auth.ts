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

/**
 * Rejects an unauthenticated request as 404, not 401.
 *
 * This is deliberate and it matters. Under the MCP spec, a 401 means "this server uses
 * OAuth" — clients are expected to read the WWW-Authenticate header, discover an
 * authorization server, and register themselves. Claude's connector does exactly that: a
 * 401 makes it try dynamic client registration, which fails with a confusing
 * "Couldn't register with this server's sign-in service" error that says nothing about
 * the actual problem (a wrong or missing secret).
 *
 * This server has no OAuth and never will — it's one user with one shared secret. Since
 * the secret IS the URL, a request without the right one is genuinely a request for a
 * resource that doesn't exist, so 404 is both honest and unambiguous. It also avoids
 * confirming to a stranger that anything is mounted here.
 */
export function rejected(): Response {
  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}
