import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { EXPECTED_MIGRATIONS } from '@/lib/migrations-manifest';

/**
 * Compares the migrations this build expects against the ones the database has applied.
 *
 * Migrations are applied by hand (`npm run migrate:prod`) rather than on deploy, because
 * Vercel has no release phase to put them in: the build command runs per-deployment, runs
 * for previews, can run concurrently, and — the real objection — instant rollback reverts
 * code while leaving schema where it is. Manual is the right call, but it has one silent
 * failure: deploy code expecting a column, forget to migrate, and the first symptom is a
 * query blowing up at request time. This turns that into a fact you can read off one URL.
 *
 * Both directions matter, and they mean different things:
 *
 *   pending  the code is ahead of the schema. A migration was forgotten. Things are
 *            actively broken, or about to be.
 *   extra    the schema is ahead of the code — normal right after a rollback, and normal
 *            mid-expand/contract. Worth seeing, not worth alarming about.
 */
async function checkMigrations(sql: ReturnType<typeof getSql>) {
  const rows = await sql`
    select filename from schema_migrations
  ` as { filename: string }[];

  const applied = new Set(rows.map((r) => r.filename));
  const pending = EXPECTED_MIGRATIONS.filter((f) => !applied.has(f));
  const extra = [...applied].filter((f) => !EXPECTED_MIGRATIONS.includes(f)).sort();

  return {
    status: pending.length > 0 ? ('pending' as const) : extra.length > 0 ? ('ahead' as const) : ('ok' as const),
    expected: EXPECTED_MIGRATIONS.length,
    applied: applied.size,
    pending,
    extra,
  };
}

// Never cache this — it's a live check that the database is reachable.
export const dynamic = 'force-dynamic';

/**
 * Proves the backend can reach Neon and reports which tables exist.
 *
 * NOTE: this route is deliberately unauthenticated so it's easy to check with a browser
 * during Phase 1. Phase 2 puts the shared-secret check in front of it along with
 * everything else.
 */
export async function GET() {
  try {
    const sql = getSql();

    const [info] = await sql`
      select
        current_database()                          as database,
        current_setting('server_version')           as postgres_version,
        now()                                       as server_time
    `;

    const tables = await sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
      order by table_name
    `;

    // A database with no schema_migrations table at all has never been migrated. That is a
    // legitimate state (a brand new Neon branch before `npm run migrate`), not an error, so
    // report it as every migration pending rather than letting the query throw.
    const migrations = tables.some((t) => t.table_name === 'schema_migrations')
      ? await checkMigrations(sql)
      : {
          status: 'pending' as const,
          expected: EXPECTED_MIGRATIONS.length,
          applied: 0,
          pending: [...EXPECTED_MIGRATIONS],
          extra: [] as string[],
        };

    // 503 when the code is ahead of the schema. This is the whole point of the check: a
    // deploy that outran its migration is not healthy, and saying ok:true next to a list of
    // pending migrations would be the response nobody reads past the first field.
    return NextResponse.json(
      {
        ok: migrations.status !== 'pending',
        database: info.database,
        postgresVersion: info.postgres_version,
        serverTime: info.server_time,
        migrations,
        tables: tables.map((t) => t.table_name),
      },
      { status: migrations.status === 'pending' ? 503 : 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
