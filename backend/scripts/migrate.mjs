#!/usr/bin/env node
//
// Applies every .sql file in ../migrations that hasn't been applied yet, in filename order,
// each one inside its own transaction. Safe to re-run — already-applied files are skipped.
//
// Plain JavaScript on purpose: Node 20 can't run TypeScript directly, and this script never
// ships to Vercel, so keeping it dependency-free beats adding a build step.
//
// Run with:  npm run migrate

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { confirmProduction, getConnectionString, printTarget } from './lib/env.mjs';

// Node 20 has no global WebSocket, and Pool talks to Neon over one.
neonConfig.webSocketConstructor = ws;

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
);

// Prefer the direct (unpooled) connection for schema changes. Neon's pooled endpoint runs
// PgBouncer, which is fine for app queries but is not the right tool for DDL.
const connectionString = getConnectionString({ direct: true });

// Migrations are the one destructive thing that legitimately has to reach production, so this
// asks rather than refuses. It is also the least reversible: a bad `alter table` is not a row
// you can log again. `npm run migrate` hits the dev branch; `npm run migrate:prod` loads
// .env.production.local and lands here.
printTarget('Migrating', { direct: true });
await confirmProduction('apply migrations', { direct: true });

const pool = new Pool({ connectionString });

async function main() {
  const client = await pool.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename   text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const { rows } = await client.query('select filename from schema_migrations');
    const applied = new Set(rows.map((r) => r.filename));

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log(`Up to date — ${files.length} migration(s) already applied.`);
      return;
    }

    for (const file of pending) {
      const sqlText = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`Applying ${file} ... `);

      try {
        await client.query('begin');
        await client.query(sqlText);
        await client.query('insert into schema_migrations (filename) values ($1)', [file]);
        await client.query('commit');
        console.log('ok');
      } catch (err) {
        await client.query('rollback');
        console.log('FAILED (rolled back, nothing was changed)');
        throw err;
      }
    }

    console.log(`\nApplied ${pending.length} migration(s).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nMigration failed: ${err.message}`);
  process.exit(1);
});
