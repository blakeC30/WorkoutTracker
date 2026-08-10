import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';

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

    return NextResponse.json({
      ok: true,
      database: info.database,
      postgresVersion: info.postgres_version,
      serverTime: info.server_time,
      tables: tables.map((t) => t.table_name),
    });
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
