#!/usr/bin/env node
//
// Prints which database the env file it loaded points at, and connects to prove the string
// works. Nothing else — no schema, no rows, no writes.
//
//   npm run db:target        # what .env.local points at (should be the dev branch)
//   npm run db:target:prod   # what .env.production.local points at
//
// Worth having because every other symptom of a misconfigured env file is indirect: seeds
// landing somewhere unexpected, a verify run that is green against the wrong data, a
// migration applied twice. This answers the question directly.

import { neon } from '@neondatabase/serverless';
import { describeTarget, getConnectionString, printTarget } from './lib/env.mjs';

printTarget('Env file loaded');

const sql = neon(getConnectionString());

try {
  const [row] = await sql`
    select current_database() as db,
           (select count(*) from journals)               as journals,
           (select count(*) from journals where is_seed) as seeded`;
  const { appEnv } = describeTarget();
  console.log(
    `Connected. ${row.db} holds ${row.journals} journal(s), ${row.seeded} of them seeded.`,
  );
  if (appEnv === 'production') {
    console.log('\nThis is production. Destructive scripts will refuse; migrate will ask.');
  }
} catch (err) {
  console.error(`\nCould not connect: ${err.message}`);
  process.exit(1);
}
