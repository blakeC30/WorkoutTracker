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
  workouts: Array<{
    exercise: string;
    entry_date: string;
    updated: boolean;
    setCount: number;
    exerciseAdded: boolean;
  }>;
  bodyweight: { entry_date: string; weight_lbs: number } | null;
  meals: Array<{
    description: string;
    entry_date: string;
    servings: number;
    food?: { id: number; name: string; created: boolean };
  }>;
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
      let exerciseId = w.exercise_id ?? null;
      let savedExercise: { id: number; name: string; created: boolean } | undefined;

      if (w.exercise) {
        const ex = w.exercise;
        const { rows } = await client.query<{ id: string; name: string; created: boolean }>(
          `insert into exercises (name, aliases, category, equipment, notes)
           values ($1, coalesce($2::text[],'{}'), $3, $4, $5)
           on conflict (name) do update set
             aliases   = (select coalesce(array_agg(distinct a), '{}')
                          from unnest(exercises.aliases || excluded.aliases) a),
             category  = coalesce(excluded.category,  exercises.category),
             equipment = coalesce(excluded.equipment, exercises.equipment),
             notes     = coalesce(excluded.notes,     exercises.notes),
             updated_at = now()
           returning id, name, (xmax = 0) as created`,
          [ex.name.trim(), ex.aliases ?? null, ex.category ?? null, ex.equipment ?? null, ex.notes ?? null],
        );
        exerciseId = Number(rows[0].id);
        savedExercise = { id: exerciseId, name: rows[0].name, created: rows[0].created };

        // Muscle names are resolved against the lookup table. An unknown name is rejected
        // rather than silently dropped — that is the whole reason muscles is normalized.
        for (const [role, names] of [
          ['primary', ex.primary_muscles ?? []],
          ['secondary', ex.secondary_muscles ?? []],
        ] as const) {
          for (const raw of names) {
            const name = raw.trim().toLowerCase();
            const { rows: mrows } = await client.query<{ id: string }>(
              'select id from muscles where lower(name) = $1',
              [name],
            );
            if (mrows.length === 0) {
              throw new Error(
                `Unknown muscle "${raw}". Call list_muscles for the valid names.`,
              );
            }
            await client.query(
              `insert into exercise_muscles (exercise_id, muscle_id, role)
               values ($1, $2, $3)
               on conflict (exercise_id, muscle_id) do update set role = excluded.role`,
              [exerciseId, mrows[0].id, role],
            );
          }
        }
      }

      if (exerciseId === null) {
        throw new Error(
          'A workout has neither exercise_id nor exercise. Every workout must point at an ' +
            'exercise — search_exercises first, and supply one inline if nothing matches.',
        );
      }

      // One workout row per exercise per day; logging it again corrects that day.
      const { rows: wrows } = await client.query<{ id: string; name: string; inserted: boolean }>(
        `insert into workouts (journal_id, entry_date, exercise_id, notes)
         values ($1, $2, $3, $4)
         on conflict (entry_date, exercise_id) do update set
           journal_id = excluded.journal_id,
           notes      = coalesce(excluded.notes, workouts.notes)
         returning id, (xmax = 0) as inserted,
                   (select name from exercises where id = $3) as name`,
        [journalId, w.entry_date, exerciseId, w.notes ?? null],
      );
      const workoutId = Number(wrows[0].id);

      // Sets are REPLACED, not appended. Re-logging a day's squats means the new list is
      // what happened — appending would silently double the volume of a correction.
      if (w.sets && w.sets.length > 0) {
        await client.query('delete from workout_sets where workout_id = $1', [workoutId]);
        let n = 0;
        for (const s of w.sets) {
          n += 1;
          await client.query(
            `insert into workout_sets
               (workout_id, set_number, reps, weight_lbs, duration_min, distance_mi, rpe, notes)
             values ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              workoutId, n, s.reps ?? null, s.weight_lbs ?? null, s.duration_min ?? null,
              s.distance_mi ?? null, s.rpe ?? null, s.notes ?? null,
            ],
          );
        }
      }

      workouts.push({
        exercise: wrows[0].name,
        entry_date: w.entry_date,
        updated: !wrows[0].inserted,
        setCount: w.sets?.length ?? 0,
        exerciseAdded: savedExercise?.created ?? false,
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
      let foodId = m.food_id ?? null;
      let savedFood: { id: number; name: string; created: boolean } | undefined;

      // A food supplied inline is upserted here, in the same transaction as the meal, so
      // cataloguing a new food is never a separate call. Matching is by name, so eating the
      // same thing again updates that food rather than duplicating it.
      if (m.food) {
        const f = m.food;
        const { rows } = await client.query<{ id: string; name: string; created: boolean }>(
          `insert into foods
             (name, unit_label, calories, protein_g, carbs_g, fat_g, aliases, source_url,
              confidence, notes)
           values ($1, coalesce($2,'serving'), $3, $4, $5, $6, coalesce($7::text[],'{}'), $8, $9, $10)
           on conflict (name) do update set
             unit_label = coalesce(excluded.unit_label, foods.unit_label),
             calories   = coalesce(excluded.calories,   foods.calories),
             protein_g  = coalesce(excluded.protein_g,  foods.protein_g),
             carbs_g    = coalesce(excluded.carbs_g,    foods.carbs_g),
             fat_g      = coalesce(excluded.fat_g,      foods.fat_g),
             -- union the alias lists so a shortcut learned once is never lost
             aliases    = (select coalesce(array_agg(distinct a), '{}')
                           from unnest(foods.aliases || excluded.aliases) a),
             source_url = coalesce(excluded.source_url, foods.source_url),
             confidence = coalesce(excluded.confidence, foods.confidence),
             notes      = coalesce(excluded.notes,      foods.notes),
             updated_at = now()
           returning id, name, (xmax = 0) as created`,
          [
            f.name.trim(), f.unit_label ?? null, f.calories ?? null, f.protein_g ?? null,
            f.carbs_g ?? null, f.fat_g ?? null, f.aliases ?? null, f.source_url ?? null,
            f.confidence ?? null, f.notes ?? null,
          ],
        );
        foodId = Number(rows[0].id);
        savedFood = { id: foodId, name: rows[0].name, created: rows[0].created };
      }

      if (foodId === null) {
        throw new Error(
          `Meal "${m.note ?? m.entry_date}" has neither food_id nor food. Every meal must ` +
            'point at a food — search_foods first, and supply a food if nothing matches.',
        );
      }

      // Look up the name when the meal referenced an existing food, so the confirmation
      // reads "2 x Nobu miso black cod" rather than "2 x food #2" — the confirmation is the
      // moment a wrong food id is cheap to catch.
      let foodName = savedFood?.name;
      if (!foodName) {
        const { rows } = await client.query<{ name: string }>(
          'select name from foods where id = $1',
          [foodId],
        );
        foodName = rows[0]?.name ?? `food #${foodId}`;
      }

      // Macros are deliberately absent here. They live on the food and are read through the
      // join, so correcting a food corrects every meal already logged with it.
      await client.query(
        `insert into meals (journal_id, entry_date, meal_type, food_id, servings, note)
         values ($1, $2, $3, $4, $5, $6)`,
        [journalId, m.entry_date, m.meal_type ?? null, foodId, m.servings ?? 1, m.note ?? null],
      );
      meals.push({
        description: foodName,
        entry_date: m.entry_date,
        servings: m.servings ?? 1,
        food: savedFood,
      });
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
    sql`select w.entry_date::text as entry_date, e.name as exercise, e.category, w.notes,
               count(s.id)::int as set_count,
               max(s.weight_lbs) as top_weight_lbs,
               sum(s.reps) as total_reps,
               sum(s.weight_lbs * s.reps) as volume_lbs,
               sum(s.distance_mi) as distance_mi,
               sum(s.duration_min) as duration_min,
               max(s.rpe) as top_rpe,
               coalesce(json_agg(json_build_object(
                 'set', s.set_number, 'reps', s.reps, 'weight_lbs', s.weight_lbs,
                 'distance_mi', s.distance_mi, 'duration_min', s.duration_min, 'rpe', s.rpe
               ) order by s.set_number) filter (where s.id is not null), '[]') as sets
        from workouts w
        join exercises e on e.id = w.exercise_id
        left join workout_sets s on s.workout_id = w.id
        where w.entry_date >= (now() at time zone ${APP_TIMEZONE})::date - ${days}::int
        group by w.id, w.entry_date, e.name, e.category, w.notes
        order by w.entry_date desc, e.name`,
    sql`select entry_date::text as entry_date, weight_lbs, notes
        from bodyweight
        where entry_date >= (now() at time zone ${APP_TIMEZONE})::date - ${days}::int
        order by entry_date desc`,
    sql`select m.entry_date::text as entry_date, m.meal_type, f.name as food,
               f.unit_label, m.servings, m.note,
               round(f.calories  * m.servings) as calories,
               round(f.protein_g * m.servings) as protein_g,
               round(f.carbs_g   * m.servings) as carbs_g,
               round(f.fat_g     * m.servings) as fat_g,
               f.confidence
        from meals m join foods f on f.id = m.food_id
        where m.entry_date >= (now() at time zone ${APP_TIMEZONE})::date - ${days}::int
        order by m.entry_date desc, m.id`,
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
    sql`select w.entry_date::text as entry_date, e.name as exercise,
               count(s.id)::int as set_count
        from workouts w
        join exercises e on e.id = w.exercise_id
        left join workout_sets s on s.workout_id = w.id
        where w.journal_id = ${journalId}
        group by w.id, w.entry_date, e.name order by e.name`,
    sql`select entry_date::text as entry_date, weight_lbs from bodyweight where journal_id = ${journalId}`,
    sql`select m.entry_date::text as entry_date, m.meal_type, f.name as description,
               m.servings, round(f.calories * m.servings) as calories
        from meals m join foods f on f.id = m.food_id
        where m.journal_id = ${journalId} order by m.id`,
  ]);

  return { journal, workouts, bodyweight, meals };
}

/** Deletes a journal row. The ON DELETE CASCADE removes everything parsed from it. */
export async function deleteJournal(journalId: number): Promise<boolean> {
  const sql = getSql();
  const rows = await sql`delete from journals where id = ${journalId} returning id`;
  return rows.length > 0;
}

/**
 * Fuzzy food search.
 *
 * Ranks by the best of three signals so short names find long ones: an exact alias match, a
 * substring match, and trigram similarity for typos. "black cod", "cod" and "blak cod" all
 * reach "nobu miso black cod". pg_trgm backs the similarity with a GIN index.
 */
export async function searchFoods(query?: string, limit = 10) {
  const sql = getSql();
  const q = query?.trim().toLowerCase() ?? '';

  if (!q) {
    return sql`
      select id, name, unit_label, calories, protein_g, carbs_g, fat_g, aliases,
             source_url, confidence
      from foods order by name limit ${limit}`;
  }

  return sql`
    select id, name, unit_label, calories, protein_g, carbs_g, fat_g, aliases,
           source_url, confidence,
           greatest(
             case when ${q} = any (select lower(a) from unnest(aliases) a) then 1.0 else 0 end,
             case when lower(name) like ${'%' + q + '%'} then 0.9 else 0 end,
             similarity(lower(name), ${q})
           ) as score
    from foods
    where lower(name) like ${'%' + q + '%'}
       or ${q} = any (select lower(a) from unnest(aliases) a)
       or similarity(lower(name), ${q}) > 0.2
    order by score desc, name
    limit ${limit}`;
}

/** Creates or updates a food by id, or by name when no id is given. */
export async function saveFood(input: {
  food_id?: number;
  name: string;
  unit_label?: string;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  aliases?: string[];
  source_url?: string;
  confidence?: 'high' | 'medium' | 'low';
  notes?: string;
}) {
  const sql = getSql();

  if (input.food_id) {
    const [row] = await sql`
      update foods set
        name       = ${input.name.trim()},
        unit_label = coalesce(${input.unit_label ?? null}, unit_label),
        calories   = coalesce(${input.calories ?? null}, calories),
        protein_g  = coalesce(${input.protein_g ?? null}, protein_g),
        carbs_g    = coalesce(${input.carbs_g ?? null}, carbs_g),
        fat_g      = coalesce(${input.fat_g ?? null}, fat_g),
        aliases    = coalesce(${input.aliases ?? null}, aliases),
        source_url = coalesce(${input.source_url ?? null}, source_url),
        confidence = coalesce(${input.confidence ?? null}, confidence),
        notes      = coalesce(${input.notes ?? null}, notes),
        updated_at = now()
      where id = ${input.food_id}
      returning id, name`;
    return { id: Number(row.id), name: row.name as string, created: false };
  }

  const [row] = await sql`
    insert into foods (name, unit_label, calories, protein_g, carbs_g, fat_g, aliases,
                       source_url, confidence, notes)
    values (${input.name.trim()}, ${input.unit_label ?? 'serving'}, ${input.calories ?? null},
            ${input.protein_g ?? null}, ${input.carbs_g ?? null}, ${input.fat_g ?? null},
            ${input.aliases ?? []}, ${input.source_url ?? null}, ${input.confidence ?? null},
            ${input.notes ?? null})
    on conflict (name) do update set
      unit_label = coalesce(excluded.unit_label, foods.unit_label),
      calories   = coalesce(excluded.calories,   foods.calories),
      protein_g  = coalesce(excluded.protein_g,  foods.protein_g),
      carbs_g    = coalesce(excluded.carbs_g,    foods.carbs_g),
      fat_g      = coalesce(excluded.fat_g,      foods.fat_g),
      confidence = coalesce(excluded.confidence, foods.confidence),
      updated_at = now()
    returning id, name, (xmax = 0) as created`;
  return { id: Number(row.id), name: row.name as string, created: row.created as boolean };
}

/** Fuzzy exercise search — same ranking as searchFoods. */
export async function searchExercises(query?: string, limit = 10) {
  const sql = getSql();
  const q = query?.trim().toLowerCase() ?? '';
  const base = sql`
    select e.id, e.name, e.aliases, e.category, e.equipment,
           coalesce(json_agg(json_build_object('muscle', m.name, 'region', m.region, 'role', em.role)
                    order by em.role, m.name) filter (where m.id is not null), '[]') as muscles
    from exercises e
    left join exercise_muscles em on em.exercise_id = e.id
    left join muscles m on m.id = em.muscle_id
    group by e.id order by e.name limit ${limit}`;
  if (!q) return base;

  return sql`
    select e.id, e.name, e.aliases, e.category, e.equipment,
           coalesce(json_agg(json_build_object('muscle', m.name, 'region', m.region, 'role', em.role)
                    order by em.role, m.name) filter (where m.id is not null), '[]') as muscles,
           greatest(
             case when ${q} = any (select lower(a) from unnest(e.aliases) a) then 1.0 else 0 end,
             case when lower(e.name) like ${'%' + q + '%'} then 0.9 else 0 end,
             similarity(lower(e.name), ${q})
           ) as score
    from exercises e
    left join exercise_muscles em on em.exercise_id = e.id
    left join muscles m on m.id = em.muscle_id
    where lower(e.name) like ${'%' + q + '%'}
       or ${q} = any (select lower(a) from unnest(e.aliases) a)
       or similarity(lower(e.name), ${q}) > 0.2
    group by e.id
    order by score desc, e.name
    limit ${limit}`;
}

/** The valid muscle names, so the model can pick from them rather than inventing. */
export async function listMuscles() {
  const sql = getSql();
  return sql`select region, array_agg(name order by name) as muscles
             from muscles group by region order by region`;
}
