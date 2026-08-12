import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { isAuthorized } from '@/lib/auth';
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
 * Two answers from one URL, depending on whether you can prove who you are.
 *
 * Anonymous callers get `{ ok }` and nothing else — a genuine liveness probe (it really does
 * round-trip to Neon) that discloses nothing. With `Authorization: Bearer <API_SECRET>` the
 * full diagnostic comes back: database name, Postgres version, migration drift, table list.
 *
 * Splitting it rather than locking it outright, because the two uses are both real and only
 * one of them is sensitive. An uptime monitor needs to poll this without holding a secret.
 * The table list and migration filenames are a map of the schema, and version strings are
 * how you shop for a matching CVE — that half has no business being public. Neither half is
 * user data; there is no path from here to a single logged meal.
 *
 * This replaces the "deliberately unauthenticated during Phase 1" note that used to sit
 * here, promising a Phase 2 that then took a while to arrive.
 */
export async function GET(request: Request) {
  const detailed = isAuthorized({ request });

  try {
    const sql = getSql();

    if (!detailed) {
      // Cheapest possible proof that the connection works. Deliberately not
      // `current_database()` — the name is a detail, and this arm returns no details.
      await sql`select 1`;
      return NextResponse.json({ ok: true });
    }

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
    // The failure arm needs the same split as the success arm. A Neon connection error names
    // the endpoint host and sometimes the role, so handing the raw message to an anonymous
    // caller would give away by failing what the authenticated response withholds.
    console.error('[health] check failed:', error);
    return NextResponse.json(
      detailed
        ? { ok: false, error: error instanceof Error ? error.message : 'Unknown error' }
        : { ok: false },
      { status: 500 },
    );
  }
}
