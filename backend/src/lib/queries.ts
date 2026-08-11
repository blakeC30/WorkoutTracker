import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { getSql } from './db';
import { getEnv } from './env';
import { APP_TIMEZONE } from './time';
import type { LogEntryInput } from './schemas';

// Node has no global WebSocket until v22, and Pool talks to Neon over one.
neonConfig.webSocketConstructor = ws;

/**
 * Reads go over the HTTP driver (getSql) — one round trip, nothing to keep alive.
 *
 * Writes go over a Pool, because log_entry needs a real interactive transaction: it inserts
 * the journal row, reads back the id Postgres assigned, then inserts the child rows using
 * that id. The HTTP driver can't do that — its `transaction([...])` takes a fixed array of
 * queries decided up front, so there's no way to feed the journal id into the next
 * statement. A Pool gives us BEGIN / COMMIT / ROLLBACK, so a half-written entry is
 * impossible: either the journal and all its children land, or nothing does.
 */
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: getEnv().DATABASE_URL });
  }
  return pool;
}

export type LogEntryResult = {
  journalId: number;
  workouts: Array<{ exercise: string; entry_date: string; updated: boolean }>;
  bodyweight: { entry_date: string; weight_lbs: number } | null;
  meals: Array<{ description: string; entry_date: string }>;
};

/**
 * Inserts one journals row plus every workout / bodyweight / meal parsed out of it,
 * all inside a single transaction.
 */
export async function logEntry(
  input: LogEntryInput,
  opts: { source: 'mcp' | 'web' },
): Promise<LogEntryResult> {
  const client = await getPool().connect();

  try {
    await client.query('begin');

    const { rows: journalRows } = await client.query<{ id: string }>(
      `insert into journals (raw_text, source, parsed_json)
       values ($1, $2, $3)
       returning id`,
      [
        input.raw_text,
        opts.source,
        JSON.stringify({
          workouts: input.workouts ?? [],
          bodyweight: input.bodyweight ?? null,
          meals: input.meals ?? [],
        }),
      ],
    );
    const journalId = Number(journalRows[0].id);

    const workouts: LogEntryResult['workouts'] = [];
    for (const w of input.workouts ?? []) {
      // One workout row per exercise per day. Logging the same exercise twice in one day
      // corrects the existing row rather than duplicating it or erroring. `xmax = 0` is a
      // Postgres trick for telling an INSERT apart from an UPDATE in the same statement:
      // it's 0 only for a freshly inserted row.
      const { rows } = await client.query<{ inserted: boolean }>(
        `insert into workouts
           (journal_id, entry_date, exercise, category, sets, reps,
            weight_lbs, duration_min, distance_mi, rpe, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         on conflict (entry_date, exercise) do update set
           journal_id   = excluded.journal_id,
           category     = coalesce(excluded.category,     workouts.category),
           sets         = coalesce(excluded.sets,         workouts.sets),
           reps         = coalesce(excluded.reps,         workouts.reps),
           weight_lbs   = coalesce(excluded.weight_lbs,   workouts.weight_lbs),
           duration_min = coalesce(excluded.duration_min, workouts.duration_min),
           distance_mi  = coalesce(excluded.distance_mi,  workouts.distance_mi),
           rpe          = coalesce(excluded.rpe,          workouts.rpe),
           notes        = coalesce(excluded.notes,        workouts.notes)
         returning (xmax = 0) as inserted`,
        [
          journalId, w.entry_date, w.exercise, w.category ?? null, w.sets ?? null,
          w.reps ?? null, w.weight_lbs ?? null, w.duration_min ?? null,
          w.distance_mi ?? null, w.rpe ?? null, w.notes ?? null,
        ],
      );
      workouts.push({
        exercise: w.exercise,
        entry_date: w.entry_date,
        updated: !rows[0].inserted,
      });
    }

    let bodyweight: LogEntryResult['bodyweight'] = null;
    if (input.bodyweight) {
      const b = input.bodyweight;
      // entry_date is unique on bodyweight — one weigh-in per day, latest wins.
      await client.query(
        `insert into bodyweight (journal_id, entry_date, weight_lbs, notes)
         values ($1, $2, $3, $4)
         on conflict (entry_date) do update set
           journal_id = excluded.journal_id,
           weight_lbs = excluded.weight_lbs,
           notes      = coalesce(excluded.notes, bodyweight.notes)`,
        [journalId, b.entry_date, b.weight_lbs, b.notes ?? null],
      );
      bodyweight = { entry_date: b.entry_date, weight_lbs: b.weight_lbs };
    }

    const meals: LogEntryResult['meals'] = [];
    for (const m of input.meals ?? []) {
      // No uniqueness constraint on meals — several meals a day is normal.
      await client.query(
        `insert into meals
           (journal_id, entry_date, description, calories, protein_g, carbs_g, fat_g, confidence)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          journalId, m.entry_date, m.description, m.calories ?? null,
          m.protein_g ?? null, m.carbs_g ?? null, m.fat_g ?? null,
          m.confidence ?? null,
        ],
      );
      meals.push({ description: m.description, entry_date: m.entry_date });
    }

    await client.query('commit');
    return { journalId, workouts, bodyweight, meals };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function getRecentHistory(days: number) {
  const sql = getSql();

  const [workouts, bodyweight, meals] = await Promise.all([
    sql`select entry_date::text as entry_date, exercise, category, sets, reps, weight_lbs,
               duration_min, distance_mi, rpe, notes
        from workouts
        where entry_date >= (now() at time zone ${APP_TIMEZONE})::date - ${days}::int
        order by entry_date desc, exercise asc`,
    sql`select entry_date::text as entry_date, weight_lbs, notes
        from bodyweight
        where entry_date >= (now() at time zone ${APP_TIMEZONE})::date - ${days}::int
        order by entry_date desc`,
    sql`select entry_date::text as entry_date, description, calories, protein_g, carbs_g, fat_g, confidence
        from meals
        where entry_date >= (now() at time zone ${APP_TIMEZONE})::date - ${days}::int
        order by entry_date desc`,
  ]);

  return { days, workouts, bodyweight, meals };
}

export async function getJournal(startDate: string, endDate: string) {
  const sql = getSql();
  // created_at is a timestamptz and entry_date is a date, so this filters on when the
  // journal was WRITTEN. That's the point of this tool — reading back what you typed.
  const entries = await sql`
    select id, raw_text, source,
           to_char(created_at at time zone ${APP_TIMEZONE}, 'YYYY-MM-DD HH24:MI') as created_at
    from journals
    where (created_at at time zone ${APP_TIMEZONE})::date >= ${startDate}::date
      and (created_at at time zone ${APP_TIMEZONE})::date <= ${endDate}::date
    order by created_at asc`;
  return { start_date: startDate, end_date: endDate, entries };
}

/** What a journal row and its children look like, for the undo preview. */
export async function describeJournal(journalId: number) {
  const sql = getSql();

  const [journal] = await sql`
    select id, raw_text, source,
           to_char(created_at at time zone ${APP_TIMEZONE}, 'YYYY-MM-DD HH24:MI') as created_at
    from journals where id = ${journalId}`;
  if (!journal) return null;

  const [workouts, bodyweight, meals] = await Promise.all([
    sql`select entry_date::text as entry_date, exercise, sets, reps, weight_lbs,
               duration_min, distance_mi
        from workouts where journal_id = ${journalId} order by exercise`,
    sql`select entry_date::text as entry_date, weight_lbs from bodyweight where journal_id = ${journalId}`,
    sql`select entry_date::text as entry_date, description, calories
        from meals where journal_id = ${journalId} order by id`,
  ]);

  return { journal, workouts, bodyweight, meals };
}

/** Deletes a journal row. The ON DELETE CASCADE removes everything parsed from it. */
export async function deleteJournal(journalId: number): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`delete from journals where id = ${journalId} returning id`;
  return rows.length > 0;
}
