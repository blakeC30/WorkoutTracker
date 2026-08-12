import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * One user, one password, one long-lived cookie.
 *
 * There is no user table and there will not be one: this app has exactly one reader, so a
 * session is only ever the claim "whoever holds this cookie typed the password once". That
 * makes the token stateless — an expiry and an HMAC over it — and stateless is what lets the
 * cookie outlive any deploy, cold start or database branch swap.
 *
 * WHY THE COOKIE IS SET BY THE SERVER, HttpOnly, AND NOT localStorage.
 *
 * Safari's Intelligent Tracking Prevention caps *script-writable* storage at seven days of
 * inactivity — localStorage, IndexedDB, and any cookie written from `document.cookie`. A
 * token kept in localStorage would therefore log you out roughly weekly, which is precisely
 * the thing being asked for here not to happen. Cookies set by the server in a `Set-Cookie`
 * response header are not script-writable and are not subject to that cap. So: HttpOnly, set
 * server-side, and the browser keeps it for the full max-age.
 *
 * That is also the honest security answer — HttpOnly means a script injected into the page
 * cannot read the session out.
 */

export const SESSION_COOKIE = 'wt_session';

/**
 * Whether the login is switched off for local development.
 *
 * An auth bypass is the single most dangerous flag a codebase can carry, because the failure
 * is silent: nothing breaks, nothing looks wrong, the site is just open. So it takes TWO
 * independent things to be true, and only one of them is a variable anyone can set.
 *
 *   1. NODE_ENV is not 'production'. Next hardcodes production into `next build` output, and
 *      Vercel builds and runs everything that way, so this is not a label someone maintains
 *      — it is a property of how the code was compiled.
 *   2. AUTH_DISABLED is explicitly 'true' or '1'. Absent, empty, or anything else means the
 *      login stays on.
 *
 * Condition 1 is the one that matters. Setting AUTH_DISABLED in Vercel by accident — pasting
 * a whole .env.local into the dashboard, say — does nothing at all, and says so in the logs
 * rather than quietly unlocking the site. Note that a local `npm run start` is a production
 * build too, so it keeps asking for a password. That is correct: the point of running the
 * production build locally is to see what production does.
 */
export function authDisabled(): boolean {
  const requested = process.env.AUTH_DISABLED === 'true' || process.env.AUTH_DISABLED === '1';

  if (process.env.NODE_ENV === 'production') {
    if (requested) {
      console.error(
        '[auth] AUTH_DISABLED is set on a production build and is being IGNORED. ' +
          'The login is still required. Remove it from the deployment environment.',
      );
    }
    return false;
  }

  return requested;
}

/**
 * The one question both the proxy and the data layer ask. Having a single answer is the
 * point: a bypass that has to be remembered in two places is a bypass that will one day be
 * removed from one of them.
 */
export function hasValidSession(token: string | undefined): boolean {
  return authDisabled() || verifySessionToken(token);
}

/**
 * 400 days. Chrome clamps cookie lifetime to 400 days and other browsers have followed, so
 * this is the practical ceiling rather than an arbitrary choice. In effect: log in once,
 * then not again for over a year unless you sign out or the secret is rotated.
 */
export const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Loud rather than open. A missing secret must never degrade to "let everyone in", which
    // is what a `return false`-shaped failure here would eventually become after someone
    // "fixes" a crash on a page they could not load.
    throw new Error(`${name} is not set — the dashboard cannot authenticate anyone without it`);
  }
  return value;
}

/** `<expires-at-ms>.<hmac>`, signed so the expiry cannot be edited by whoever holds it. */
export function createSessionToken(now = Date.now()): string {
  const expiresAt = now + SESSION_MAX_AGE_SECONDS * 1000;
  return `${expiresAt}.${sign(String(expiresAt))}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;

  const separator = token.lastIndexOf('.');
  if (separator < 1) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  // Signature first, then expiry. Checking expiry first would let an unsigned token control
  // which branch runs, which is the sort of thing that turns into an oracle.
  if (!safeEqual(signature, sign(payload))) return false;

  const expiresAt = Number(payload);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function sign(payload: string): string {
  return createHmac('sha256', requireEnv('SESSION_SECRET')).update(payload).digest('hex');
}

/**
 * Constant-time compare. `a === b` on a signature leaks, through timing, how many leading
 * characters were right — which is enough to reconstruct one byte at a time given patience.
 */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, and the throw itself is a timing signal.
  // Lengths here are fixed-width hex digests, so an unequal length is malformed input.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Check a typed password against `AUTH_PASSWORD_HASH` (`<salt-hex>:<key-hex>`, scrypt).
 *
 * scrypt rather than a bare SHA: a plain digest of a password is brute-forceable at billions
 * of guesses per second on a GPU. scrypt is deliberately slow and memory-hard, so an attacker
 * who somehow obtained the hash still cannot grind it. Generate the value with
 * `npm run auth:setup`.
 */
export function verifyPassword(password: string): boolean {
  const stored = requireEnv('AUTH_PASSWORD_HASH');
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) {
    throw new Error('AUTH_PASSWORD_HASH is malformed — regenerate it with npm run auth:setup');
  }

  const expected = Buffer.from(keyHex, 'hex');
  const actual = scryptSync(password.normalize('NFKC'), Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Used by the setup script; lives here so hashing and verifying can never drift apart. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFKC'), salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}
