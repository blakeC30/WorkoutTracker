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
    /** Sets that already existed for this exercise on this date and were thrown away. */
    setsReplaced: number;
    appended: boolean;
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
          `insert into exercises (name, aliases, category, pattern, equipment, notes)
           values ($1, coalesce($2::text[],'{}'), $3, $4, $5, $6)
           -- Conflict on lower(name), matching the case-insensitive unique index from 007:
           -- logging "Bench Press" after "bench press" updates the existing row instead of
           -- creating a second exercise that splits the history.
           on conflict (lower(name)) do update set
             aliases   = (select coalesce(array_agg(distinct a), '{}')
                          from unnest(exercises.aliases || excluded.aliases) a),
             category  = coalesce(excluded.category,  exercises.category),
             pattern   = coalesce(excluded.pattern,   exercises.pattern),
             equipment = coalesce(excluded.equipment, exercises.equipment),
             notes     = coalesce(excluded.notes,     exercises.notes),
             updated_at = now()
           returning id, name, (xmax = 0) as created`,
          [
            ex.name.trim(),
            ex.aliases ?? null,
            ex.category ?? null,
            // Falls back to the category so a cardio exercise logged without a pattern still
            // lands somewhere the calendar can group it, rather than in `other`.
            ex.pattern ?? (ex.category === 'cardio' ? 'cardio' : null),
            ex.equipment ?? null,
            ex.notes ?? null,
          ],
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

      /*
       * Replacing is the default because a re-log is usually a correction, and appending a
       * correction doubles the day's volume.
       *
       * But it is destructive, and it used to be the ONLY behaviour: a second session, a second
       * walk, or an afterthought — "I forgot, I also did two more sets" — silently deleted the
       * sets already stored, leaving the journal text as the only surviving record of them.
       * `set_mode: 'append'` is the way to say "this is more work, not a restatement".
       *
       * Whichever mode ran, how many rows it destroyed is reported back, so a replace the user
       * did not intend is visible in the confirmation instead of three weeks later in a chart.
       */
      let setsReplaced = 0;
      if (w.sets && w.sets.length > 0) {
        let firstSetNumber = 1;

        if (w.set_mode === 'append') {
          // Continue the day's numbering rather than restarting it, or the second session's
          // sets collide with the first's and the order they were performed in is lost.
          const { rows: maxRows } = await client.query<{ last: number }>(
            'select coalesce(max(set_number), 0)::int as last from workout_sets where workout_id = $1',
            [workoutId],
          );
          firstSetNumber = maxRows[0].last + 1;
        } else {
          const deleted = await client.query(
            'delete from workout_sets where workout_id = $1',
            [workoutId],
          );
          setsReplaced = deleted.rowCount ?? 0;
        }

        let n = firstSetNumber - 1;
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
        setsReplaced,
        appended: w.set_mode === 'append',
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
           on conflict (lower(name)) do update set
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
    // Ids are returned so rows can be deleted individually. Without them the only thing
    // addressable is a whole journal, which is why "delete just the basketball" used to be
    // impossible when the same message also logged a deadlift session.
    sql`select w.id, w.journal_id, w.entry_date::text as entry_date, e.name as exercise, e.category, e.pattern, w.notes,
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
        group by w.id, w.journal_id, w.entry_date, e.name, e.category, e.pattern, w.notes
        order by w.entry_date desc, e.name`,
    sql`select id, journal_id, entry_date::text as entry_date, weight_lbs, notes
        from bodyweight
        where entry_date >= (now() at time zone ${APP_TIMEZONE})::date - ${days}::int
        order by entry_date desc`,
    sql`select m.id, m.journal_id, m.entry_date::text as entry_date, m.meal_type, f.name as food,
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

/**
 * Resolves what a deletion would remove, without removing it.
 *
 * Rows are addressable two ways and they union: by the journal that produced them, or by their
 * own ids. Both exist because the two real requests are different — "that whole message was
 * wrong" and "that one dish was wrong" — and collapsing them into one would make the common
 * case clumsy or the precise case impossible.
 *
 * Journals are NOT in the return value as deletion targets, because they are never deleted.
 * They appear only as context: which message each doomed row came from, and which messages
 * will be left having produced nothing.
 */
export async function resolveDeletion(input: {
  journal_id?: number;
  workout_ids?: number[];
  meal_ids?: number[];
  bodyweight_ids?: number[];
}) {
  const sql = getSql();
  const j = input.journal_id ?? null;
  const w = input.workout_ids ?? [];
  const m = input.meal_ids ?? [];
  const b = input.bodyweight_ids ?? [];

  const [workouts, meals, bodyweight] = await Promise.all([
    sql`select wo.id, wo.journal_id, wo.entry_date::text as entry_date, e.name as exercise,
               count(s.id)::int as set_count
        from workouts wo
        join exercises e on e.id = wo.exercise_id
        left join workout_sets s on s.workout_id = wo.id
        where (${j}::bigint is not null and wo.journal_id = ${j}::bigint)
           or wo.id = any(${w}::bigint[])
        group by wo.id, wo.journal_id, wo.entry_date, e.name
        order by wo.entry_date, e.name`,
    sql`select me.id, me.journal_id, me.entry_date::text as entry_date, me.meal_type,
               me.servings, f.name as food,
               round(f.calories * me.servings) as calories
        from meals me join foods f on f.id = me.food_id
        where (${j}::bigint is not null and me.journal_id = ${j}::bigint)
           or me.id = any(${m}::bigint[])
        order by me.entry_date, me.id`,
    sql`select id, journal_id, entry_date::text as entry_date, weight_lbs
        from bodyweight
        where (${j}::bigint is not null and journal_id = ${j}::bigint)
           or id = any(${b}::bigint[])
        order by entry_date`,
  ]);

  const ids = {
    workouts: workouts.map((r) => Number(r.id)),
    meals: meals.map((r) => Number(r.id)),
    bodyweight: bodyweight.map((r) => Number(r.id)),
  };

  // Journals that would be left having produced nothing at all. Worth surfacing because the
  // text survives while becoming unreachable from the dashboard — the day page finds journals
  // through the rows they produced, so a journal with none appears on no day.
  const touched = [...new Set([...workouts, ...meals, ...bodyweight]
    .map((r) => (r.journal_id === null ? null : Number(r.journal_id)))
    .filter((x): x is number => x !== null))];

  const orphaned = touched.length === 0 ? [] : await sql`
    select jo.id, left(jo.raw_text, 120) as raw_text
    from journals jo
    where jo.id = any(${touched}::bigint[])
      and not exists (select 1 from workouts   x where x.journal_id = jo.id
                        and not (x.id = any(${ids.workouts}::bigint[])))
      and not exists (select 1 from meals      x where x.journal_id = jo.id
                        and not (x.id = any(${ids.meals}::bigint[])))
      and not exists (select 1 from bodyweight x where x.journal_id = jo.id
                        and not (x.id = any(${ids.bodyweight}::bigint[])))
    order by jo.id`;

  return { workouts, meals, bodyweight, orphaned, ids, empty: ids.workouts.length === 0 && ids.meals.length === 0 && ids.bodyweight.length === 0 };
}

/**
 * Deletes log rows. Never a journal.
 *
 * The journal is the record of what was SAID, and it was said — deleting it would falsify the
 * account. What gets removed here is the INTERPRETATION: the rows parsed out of that text,
 * which are the only part that can be wrong. This is the same rule the dashboard already
 * follows when a value is corrected by hand, extended from editing to deleting.
 *
 * `on delete cascade` from journals is deliberately left in place even though nothing here
 * uses it. It costs nothing, it is what `npm run seed:clear` deletes through, and a policy
 * enforced in one function is easier to change than a dropped constraint is to restore.
 */
export async function deleteEntries(ids: {
  workouts: number[];
  meals: number[];
  bodyweight: number[];
}): Promise<{ workouts: number; meals: number; bodyweight: number }> {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    // workout_sets go with their workout through the cascade in migration 005.
    const w = await client.query('delete from workouts where id = any($1::bigint[])', [ids.workouts]);
    const m = await client.query('delete from meals where id = any($1::bigint[])', [ids.meals]);
    const b = await client.query('delete from bodyweight where id = any($1::bigint[])', [ids.bodyweight]);
    await client.query('commit');
    return { workouts: w.rowCount ?? 0, meals: m.rowCount ?? 0, bodyweight: b.rowCount ?? 0 };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
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
    on conflict (lower(name)) do update set
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
  // `pattern` is selected alongside category deliberately. Without it the model can SET a
  // pattern when it creates an exercise inline but can never SEE one, so a movement filed under
  // the wrong pattern is invisible and stays wrong forever — and pattern is the axis the whole
  // calendar groups days by. Returning it makes a bad value noticeable at the moment the
  // exercise is looked up, which is the only moment anyone is thinking about it.
  const base = sql`
    select e.id, e.name, e.aliases, e.category, e.pattern, e.equipment,
           coalesce(json_agg(json_build_object('muscle', m.name, 'region', m.region, 'role', em.role)
                    order by em.role, m.name) filter (where m.id is not null), '[]') as muscles
    from exercises e
    left join exercise_muscles em on em.exercise_id = e.id
    left join muscles m on m.id = em.muscle_id
    group by e.id order by e.name limit ${limit}`;
  if (!q) return base;

  return sql`
    select e.id, e.name, e.aliases, e.category, e.pattern, e.equipment,
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

/**
 * Creates or corrects an exercise — the twin of saveFood, and for a long time the missing one.
 *
 * Without it the only way to touch an exercise was to log a workout with the movement supplied
 * inline, because that path upserts. So fixing a pattern meant inventing a training session,
 * and renaming was impossible outright: the upsert matches on lower(name), so "Barbell Back
 * Squat" over "barbell back squt" created a SECOND exercise and split the history in half
 * rather than repairing it. Passing exercise_id here updates the row in place, which is what
 * makes a rename a rename.
 *
 * A Pool rather than the HTTP driver, because muscles live in their own table: correcting a
 * movement's muscles is a delete and a set of inserts that must land together with the name
 * change or not at all.
 */
export async function saveExercise(input: {
  exercise_id?: number;
  name: string;
  aliases?: string[];
  category?: string;
  pattern?: string;
  equipment?: string;
  primary_muscles?: string[];
  secondary_muscles?: string[];
  notes?: string;
}): Promise<{ id: number; name: string; created: boolean; renamedFrom?: string }> {
  const client = await getPool().connect();

  try {
    await client.query('begin');

    let id: number;
    let name: string;
    let created: boolean;
    let renamedFrom: string | undefined;

    if (input.exercise_id) {
      const { rows: before } = await client.query<{ name: string }>(
        'select name from exercises where id = $1',
        [input.exercise_id],
      );
      if (before.length === 0) {
        throw new Error(
          `No exercise #${input.exercise_id}. Call search_exercises to find the right id.`,
        );
      }

      // Every field but the name is coalesced, so omitting one leaves it alone. The name is
      // NOT: this is the only path that can rename, and coalescing it would mean the tool
      // silently declined to do the one thing it uniquely exists for.
      const { rows } = await client.query<{ id: string; name: string }>(
        `update exercises set
           name      = $2,
           aliases   = case when $3::text[] is null then aliases
                            else (select coalesce(array_agg(distinct a), '{}')
                                  from unnest(aliases || $3::text[]) a) end,
           category  = coalesce($4, category),
           pattern   = coalesce($5, pattern),
           equipment = coalesce($6, equipment),
           notes     = coalesce($7, notes),
           updated_at = now()
         where id = $1
         returning id, name`,
        [
          input.exercise_id, input.name.trim(), input.aliases ?? null, input.category ?? null,
          input.pattern ?? null, input.equipment ?? null, input.notes ?? null,
        ],
      );
      id = Number(rows[0].id);
      name = rows[0].name;
      created = false;
      if (before[0].name !== name) renamedFrom = before[0].name;
    } else {
      const { rows } = await client.query<{ id: string; name: string; created: boolean }>(
        `insert into exercises (name, aliases, category, pattern, equipment, notes)
         values ($1, coalesce($2::text[],'{}'), $3, $4, $5, $6)
         on conflict (lower(name)) do update set
           aliases   = (select coalesce(array_agg(distinct a), '{}')
                        from unnest(exercises.aliases || excluded.aliases) a),
           category  = coalesce(excluded.category,  exercises.category),
           pattern   = coalesce(excluded.pattern,   exercises.pattern),
           equipment = coalesce(excluded.equipment, exercises.equipment),
           notes     = coalesce(excluded.notes,     exercises.notes),
           updated_at = now()
         returning id, name, (xmax = 0) as created`,
        [
          input.name.trim(), input.aliases ?? null, input.category ?? null,
          input.pattern ?? (input.category === 'cardio' ? 'cardio' : null),
          input.equipment ?? null, input.notes ?? null,
        ],
      );
      id = Number(rows[0].id);
      name = rows[0].name;
      created = rows[0].created;
    }

    // Muscles are REPLACED per role, and only for a role that was actually supplied. Merging
    // would make a correction impossible — the wrong muscle you are here to remove would
    // survive every attempt to remove it. Omitting the field entirely leaves that role as it is.
    for (const [role, names] of [
      ['primary', input.primary_muscles],
      ['secondary', input.secondary_muscles],
    ] as const) {
      if (!names) continue;
      await client.query(
        'delete from exercise_muscles where exercise_id = $1 and role = $2',
        [id, role],
      );
      for (const raw of names) {
        const { rows: mrows } = await client.query<{ id: string }>(
          'select id from muscles where lower(name) = $1',
          [raw.trim().toLowerCase()],
        );
        if (mrows.length === 0) {
          throw new Error(`Unknown muscle "${raw}". Call list_muscles for the valid names.`);
        }
        await client.query(
          `insert into exercise_muscles (exercise_id, muscle_id, role)
           values ($1, $2, $3)
           on conflict (exercise_id, muscle_id) do update set role = excluded.role`,
          [id, mrows[0].id, role],
        );
      }
    }

    await client.query('commit');
    return { id, name, created, renamedFrom };
  } catch (error) {
    await client.query('rollback');
    // The unique index on lower(name) is the likeliest failure here, and its raw message names
    // an index rather than the problem. Renaming onto a name already in use is a real
    // situation — two spellings of one movement, both with history — and merging them is not
    // something a tool should do behind your back.
    // 23505 is unique_violation; the index is the one migration 007 created.
    if (
      typeof error === 'object' && error !== null &&
      (error as { code?: string }).code === '23505' &&
      String((error as { constraint?: string }).constraint ?? '').includes('exercises_name_lower')
    ) {
      throw new Error(
        `Another exercise is already called "${input.name.trim()}". Two exercises cannot ` +
          'share a name. Log against the existing one instead, or pick a different name.',
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

/** The valid muscle names, so the model can pick from them rather than inventing. */
export async function listMuscles() {
  const sql = getSql();
  return sql`select region, array_agg(name order by name) as muscles
             from muscles group by region order by region`;
}
