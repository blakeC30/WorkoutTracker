// Which database is this script about to touch, and is it allowed to?
//
// The scheme rests on one inversion. `.env.local` points at the Neon **dev branch**, so every
// npm script defaults to dev; production requires naming it (`npm run migrate:prod`, which
// loads `.env.production.local`). Forgetting therefore fails safe, which is the opposite of
// how this repo started — where `.env.local` held production and safety was a memory task.
//
// APP_ENV is the authority, never the hostname. A connection string can be pasted anywhere,
// and inferring "this looks like production" from a URL is the kind of guess that holds right
// up until the day it doesn't. An APP_ENV nobody set reads as production: the unknown case is
// the dangerous one, so it gets the strict treatment.

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_DIR = path.resolve(fileURLToPath(import.meta.url), '../../..');
const PROD_ENV_FILE = path.join(BACKEND_DIR, '.env.production.local');

export function getConnectionString({ direct = false } = {}) {
  const cs = direct
    ? process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
    : process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!cs) {
    console.error(
      'DATABASE_URL is not set.\n' +
        'Copy backend/.env.example to backend/.env.local and fill it in with your Neon\n' +
        'DEV BRANCH connection string — not production. See the README.',
    );
    process.exit(1);
  }
  return cs;
}

/** 'production' | 'development'. Anything unset or unrecognised is treated as production. */
export function getAppEnv() {
  const raw = (process.env.APP_ENV || '').trim().toLowerCase();
  if (raw === 'development' || raw === 'dev') return 'development';
  if (raw === 'production' || raw === 'prod') return 'production';
  return 'production';
}

export function isAppEnvDeclared() {
  return Boolean((process.env.APP_ENV || '').trim());
}

/** Host and database name, for showing a human what they are pointed at. */
export function describeTarget({ direct = false } = {}) {
  const cs = getConnectionString({ direct });
  let host = '(unparseable)';
  let database = '(unknown)';
  try {
    const u = new URL(cs);
    host = u.host;
    database = u.pathname.replace(/^\//, '') || '(default)';
  } catch {
    // A malformed string is the connection's problem to report, not ours.
  }
  return { appEnv: getAppEnv(), host, database, declared: isAppEnvDeclared() };
}

export function printTarget(action, opts = {}) {
  const { appEnv, host, database, declared } = describeTarget(opts);
  const label = appEnv === 'production' ? 'PRODUCTION' : 'development';
  console.log(`${action}\n  target      ${label}\n  host        ${host}\n  database    ${database}`);
  if (!declared) {
    console.log('  note        APP_ENV is not set, so this is assumed to be production.');
  }
  console.log('');
}

// The one mistake that would quietly defeat the whole scheme: pasting the production
// connection string into .env.local and leaving APP_ENV=development above it. The file then
// says dev, the socket goes to prod, and every guard here waves it through. Compare against
// the production file when there is one — it is the only place that knows prod's real host.
function crossCheckAgainstProductionFile(host) {
  let prodFile;
  try {
    prodFile = readFileSync(PROD_ENV_FILE, 'utf8');
  } catch {
    return null; // No production file locally. Nothing to compare, and that is fine.
  }
  const match = prodFile.match(/^\s*DATABASE_URL(?:_UNPOOLED)?\s*=\s*(.+)$/m);
  if (!match) return null;
  try {
    const prodHost = new URL(match[1].trim().replace(/^["']|["']$/g, '')).host;
    // Neon's pooled and direct endpoints differ only by a "-pooler" suffix on the host.
    const strip = (h) => h.replace('-pooler', '');
    return strip(prodHost) === strip(host) ? prodHost : null;
  } catch {
    return null;
  }
}

/**
 * Refuse outright when pointed at production. For operations that have no business ever
 * running there — seeding invented history, clearing rows.
 */
export function assertNotProduction(action, { direct = false } = {}) {
  const { appEnv, host, database, declared } = describeTarget({ direct });

  // Order matters. The cross-check only means anything when the label claims development —
  // if APP_ENV already says production the plain refusal below is the honest message, and
  // reporting a "mismatch" between two signals that agree would just be confusing.
  if (appEnv !== 'production') {
    const collision = crossCheckAgainstProductionFile(host);
    if (!collision) return;
    console.error(
      `\nRefusing to ${action}.\n\n` +
        `APP_ENV says development, but this connection points at the same host as\n` +
        `backend/.env.production.local:\n\n  ${collision}\n\n` +
        `The label and the socket disagree, and the socket is the one that matters.\n` +
        `Fix backend/.env.local to use your Neon dev branch connection string.\n`,
    );
    process.exit(1);
  }

  console.error(
    `\nRefusing to ${action}: this is ${declared ? 'production' : 'assumed to be production'}.\n\n` +
      `  host        ${host}\n  database    ${database}\n\n` +
      (declared
        ? `Run it against your Neon dev branch instead — that is what backend/.env.local is\n` +
          `for. On a branch this operation is free and reversible.\n`
        : `APP_ENV is not set in the env file this loaded, so it is treated as production.\n` +
          `Add APP_ENV=development to backend/.env.local once it points at your dev branch.\n`),
  );
  process.exit(1);
}

/**
 * Allow production, but only after the operator types the database name. For operations that
 * legitimately have to run there — migrations.
 *
 * A y/n prompt is muscle memory; typing the database name requires reading the line above it.
 */
export async function confirmProduction(action, { direct = false } = {}) {
  const { appEnv, host, database } = describeTarget({ direct });
  if (appEnv !== 'production') return;

  if (process.argv.includes('--yes')) {
    console.log(`--yes given; proceeding against production (${host}).\n`);
    return;
  }

  if (!stdin.isTTY) {
    console.error(
      `\nRefusing to ${action} against production from a non-interactive shell.\n` +
        `Re-run in a terminal, or pass --yes if this is deliberate automation.\n`,
    );
    process.exit(1);
  }

  console.log(
    `\nThis will ${action} against PRODUCTION.\n\n` +
      `  host        ${host}\n  database    ${database}\n\n` +
      `There is no undo. Type the database name to continue, anything else to abort.`,
  );
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question('  database name: ')).trim();
  rl.close();

  if (answer !== database) {
    console.error('\nAborted. Nothing was changed.\n');
    process.exit(1);
  }
  console.log('');
}
