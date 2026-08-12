#!/usr/bin/env node
//
// Generates the two secrets the dashboard login needs, and prints them ready to paste.
//
//   npm run auth:setup                 # invents a strong password for you
//   npm run auth:setup -- "my phrase"  # hashes one you chose
//
// Nothing here writes to .env.local or to Vercel. Both values have to be set in both places
// by hand, which is tedious exactly once and means this script can never clobber a working
// login on a whim.

import { randomBytes, scryptSync } from 'node:crypto';

// Duplicated from src/lib/session.ts rather than imported: that file is TypeScript, this is a
// plain node script with no build step, and the alternative is adding tooling to share ten
// lines. If you change the parameters there, change them here — a mismatch shows up
// immediately as a password that never verifies.
function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFKC'), salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

// Ambiguity-free alphabet. No 0/O, no 1/l/I — this gets typed on a phone keyboard at least
// once, and possibly read off a screen while doing it.
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';

function invent(length = 24) {
  const bytes = randomBytes(length * 2);
  let out = '';
  for (let i = 0; out.length < length; i += 1) {
    // Reject bytes that would bias the distribution rather than taking a modulo of everything.
    const b = bytes[i % bytes.length];
    if (b < 256 - (256 % ALPHABET.length)) out += ALPHABET[b % ALPHABET.length];
  }
  return out.replace(/(.{6})(?=.)/g, '$1-');
}

const chosen = process.argv.slice(2).find((a) => !a.startsWith('-'));
const password = chosen ?? invent();
const sessionSecret = randomBytes(32).toString('hex');

console.log(`
${chosen ? 'Using the password you supplied.' : 'Generated a password. This is the only time it is shown:'}

  ${password}

Save it in your password manager now, then put these two lines in web/.env.local AND in the
web project's environment variables on Vercel:

SESSION_SECRET=${sessionSecret}
AUTH_PASSWORD_HASH=${hashPassword(password)}

Notes:

  - SESSION_SECRET signs the session cookie. Changing it later signs everyone out
    immediately, which is how you revoke a session on a device you no longer have.
  - AUTH_PASSWORD_HASH is a scrypt hash. The password itself is not stored anywhere and
    cannot be recovered from this — losing it means re-running this script.
  - Set both in Vercel BEFORE deploying, or the first request after deploy throws rather
    than letting anyone in.
`);
