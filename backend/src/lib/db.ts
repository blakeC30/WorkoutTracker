import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { getEnv } from './env';

/**
 * The one Postgres client for the whole backend. Nothing else in the repo — and nothing in
 * web/ at all — is allowed to talk to Neon.
 *
 * This is the HTTP driver: one round trip per query, no connection to keep alive, which is
 * what you want in a serverless function. It cannot do interactive transactions
 * (BEGIN ... COMMIT across separate calls). For the multi-table write in log_entry we'll
 * use `sql.transaction([...])`, which sends a batch of statements as a single atomic
 * transaction in one request.
 *
 * Lazily constructed so importing this module doesn't require credentials at build time.
 */
let cached: NeonQueryFunction<false, false> | null = null;

export function getSql(): NeonQueryFunction<false, false> {
  if (!cached) {
    cached = neon(getEnv().DATABASE_URL);
  }
  return cached;
}
