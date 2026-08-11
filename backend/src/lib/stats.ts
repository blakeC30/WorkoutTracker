import { getSql } from './db';
import { APP_TIMEZONE } from './time';

/**
 * Aggregate queries behind both the MCP analysis tools and the dashboard's REST API.
 *
 * They live together because a PR means the same thing whether Claude is asked on a phone
 * or a chart draws it — two implementations would drift, and the one you weren't looking at
 * would be the wrong one.
 */

// Today, in the timezone the log is kept in — not the database server's idea of today.
// Written inline as `(now() at time zone ${APP_TIMEZONE})::date` at each call site: in a
// tagged template `${...}` becomes a bound PARAMETER, so a helper returning SQL text would
// be passed to Postgres as a string value rather than executed. Only the timezone is a
// parameter, which is exactly what `at time zone` expects.

/**
 * Personal records per exercise.
 *
 * Two different records, because "PR" is ambiguous and both matter:
 *   - heaviest    the largest weight moved for any number of reps
 *   - best e1RM   estimated one-rep max via Epley (w x (1 + reps/30))
 *
 * A 5-rep set at 225 beats a single at 235 on estimated max but loses on heaviest, and
 * which one counts depends on what you're asking. Reporting only the heaviest hides
 * progress made by adding reps rather than weight, which is most of it.
 */
export async function getPrs(opts: { exercise?: string; limit?: number } = {}) {
  const sql = getSql();
  const limit = opts.limit ?? 25;
  const term = opts.exercise ? `%${opts.exercise.trim().toLowerCase()}%` : null;

  return sql`
    with matched as (
      select e.id as exercise_id, e.name as exercise, e.category, e.pattern,
             w.entry_date, s.reps, s.weight_lbs, s.distance_mi, s.duration_min
      from workout_sets s
      join workouts w  on w.id = s.workout_id
      join exercises e on e.id = w.exercise_id
      where (${term}::text is null or lower(e.name) like ${term})
    ),
    -- Loaded work: heaviest set and best estimated max.
    weighted as (
      select exercise_id, entry_date, reps, weight_lbs,
             weight_lbs * (1 + reps::numeric / 30) as e1rm
      from matched
      where weight_lbs is not null and reps is not null and reps <= 12
    ),
    heaviest as (
      select distinct on (exercise_id) exercise_id, weight_lbs, reps, entry_date
      from weighted order by exercise_id, weight_lbs desc, reps desc, entry_date asc
    ),
    best_e1rm as (
      select distinct on (exercise_id) exercise_id, e1rm, weight_lbs, reps, entry_date
      from weighted order by exercise_id, e1rm desc, entry_date asc
    ),
    -- Bodyweight work: push-ups, sit-ups, pull-ups, air squats.
    --
    -- A third kind of record, and the one this query used to have no notion of. These sets
    -- carry reps but no load, so they never enter the weighted CTE, and they carry no distance
    -- or duration either, so they never enter the endurance one. The result was that a push-up filed
    -- itself under "Cardio & timed" with every metric null and rendered as an em-dash — three
    -- sets and fifty-three reps reported as nothing at all.
    --
    -- The record here is the best SET, not the total: adding a rep to your best set is the
    -- calisthenic equivalent of adding weight to the bar, while total reps mostly tracks how
    -- long you spent.
    calisthenic as (
      select distinct on (exercise_id) exercise_id, reps, entry_date
      from matched
      where reps is not null and coalesce(weight_lbs, 0) = 0
      order by exercise_id, reps desc, entry_date asc
    ),
    -- One value per day per exercise, in whatever unit that exercise is measured in.
    --
    -- This exists so each row on the Lifts list can be drawn against ITS OWN history. The list
    -- previously scaled every bar against the heaviest exercise in it, which put a curl at 11%
    -- of a leg press — a comparison that cannot mean anything, since nobody curls what they leg
    -- press. Trending an exercise against itself is the only comparison that does.
    --
    -- The coalesce picks the measure the exercise actually uses, in the same priority the record
    -- types use: loaded, then unloaded reps, then distance, then time. Mixing units across rows
    -- is fine precisely because these series are never compared to each other.
    per_day as (
      select exercise_id, entry_date,
             coalesce(
               max(case when weight_lbs > 0 and reps is not null and reps <= 12
                        then weight_lbs * (1 + reps::numeric / 30) end),
               max(case when coalesce(weight_lbs, 0) = 0 then reps end),
               max(distance_mi),
               max(duration_min)
             ) as value
      from matched
      group by exercise_id, entry_date
    ),
    -- Unloaded work: cardio and timed holds. Without this, running, rowing and planks have
    -- no record of any kind and simply vanish from the list — the longest run of the block
    -- is as much a PR as the heaviest single.
    endurance as (
      select exercise_id,
             max(distance_mi)  as best_distance_mi,
             max(duration_min) as best_duration_min,
             min(case when distance_mi > 0 and duration_min > 0
                      then duration_min / distance_mi end) as best_pace_min_per_mi
      from matched
      where distance_mi is not null or duration_min is not null
      group by exercise_id
    )
    select m.exercise, m.category, m.pattern,
           -- Grouped by KIND of exercise, not by unit of measurement.
           --
           -- Measuring-unit was the obvious split — weight, reps, distance/time — but it filed
           -- planks beside the rowing machine, because a hold is recorded in minutes. Reading
           -- "cardio" over an ab exercise is worse than having two units in one section, and
           -- the unit argument was weak anyway: the loaded section already puts a 380lb leg
           -- press next to a 42lb curl.
           --
           -- Loaded still wins when an exercise has both, so a weighted pull-up is measured by
           -- the weight while its bodyweight sets still count toward the total.
           case when h.exercise_id is not null then 'weighted'
                when m.pattern = 'cardio'      then 'endurance'
                else 'bodyweight' end as record_type,
           c.reps              as best_reps,
           c.entry_date::text  as best_reps_on,
           sum(m.reps) filter (where coalesce(m.weight_lbs, 0) = 0)::int as total_bodyweight_reps,
           h.weight_lbs        as heaviest_lbs,
           h.reps              as heaviest_reps,
           h.entry_date::text  as heaviest_on,
           round(b.e1rm)       as best_e1rm_lbs,
           b.weight_lbs        as best_e1rm_weight,
           b.reps              as best_e1rm_reps,
           b.entry_date::text  as best_e1rm_on,
           en.best_distance_mi,
           en.best_duration_min,
           round(en.best_pace_min_per_mi, 2) as best_pace_min_per_mi,
           count(*)::int           as total_sets,
           max(m.entry_date)::text as last_performed,
           -- The last ten sessions, oldest first, so the row can draw its own trend. The inner
           -- query takes the most RECENT ten and the outer aggregation re-sorts them ascending;
           -- ordering ascending inside would pin the series to the first ten ever recorded.
           (select json_agg(round(v.value, 2) order by v.entry_date)
            from (select entry_date, value
                  from per_day p
                  where p.exercise_id = m.exercise_id and p.value is not null
                  order by p.entry_date desc
                  limit 10) v) as trend
    from matched m
    left join heaviest  h  on h.exercise_id  = m.exercise_id
    left join best_e1rm b  on b.exercise_id  = m.exercise_id
    left join endurance en on en.exercise_id = m.exercise_id
    left join calisthenic c on c.exercise_id = m.exercise_id
    -- m.exercise_id is grouped so the trend subquery can correlate on it. It is 1:1 with the
    -- name, so this does not change how rows are grouped.
    group by m.exercise_id, m.exercise, m.category, m.pattern,
             h.exercise_id, h.weight_lbs, h.reps, h.entry_date,
             b.e1rm, b.weight_lbs, b.reps, b.entry_date,
             en.best_distance_mi, en.best_duration_min, en.best_pace_min_per_mi,
             c.exercise_id, c.reps, c.entry_date
    order by max(m.entry_date) desc
    limit ${limit}`;
}

/**
 * One exercise, every session of it, oldest first.
 *
 * The question this exists to answer is "am I getting stronger at this", which nothing else in
 * the app could answer: `getPrs` returns a single current best per exercise, so a lift that has
 * been stalled for two months and one that added 40lb last week look identical.
 *
 * Estimated 1RM is the series to plot rather than top weight, because it moves when reps go up
 * at the same load — which is most of how progress actually arrives. Reps above 12 are excluded
 * from the estimate for the same reason PRs exclude them: Epley drifts badly on long sets and a
 * 20-rep back-off set would post a fake record.
 */
export async function getExerciseHistory(name: string, limit = 120) {
  const sql = getSql();
  const key = name.trim().toLowerCase();

  const [meta] = await sql`
    select e.id, e.name, e.category, e.pattern, e.equipment, e.notes,
           coalesce(
             (select json_agg(json_build_object('name', m.name, 'region', m.region, 'role', em.role)
                     order by em.role, m.name)
              from exercise_muscles em join muscles m on m.id = em.muscle_id
              where em.exercise_id = e.id), '[]'::json) as muscles
    from exercises e
    where lower(e.name) = ${key}
    limit 1`;

  if (!meta) return null;

  const sessions = await sql`
    select w.entry_date::text as date,
           count(s.id)::int                    as sets,
           sum(s.reps)::int                    as total_reps,
           round(sum(s.reps * s.weight_lbs))   as volume_lbs,
           max(s.weight_lbs)                   as top_weight,
           round(max(s.weight_lbs * (1 + s.reps::numeric / 30))
                 filter (where s.reps <= 12))  as e1rm,
           round(sum(s.distance_mi), 2)        as distance_mi,
           round(sum(s.duration_min))          as duration_min,
           round(avg(s.rpe), 1)                as avg_rpe,
           coalesce((
             select json_agg(json_build_object(
                      'set_number', s2.set_number, 'reps', s2.reps, 'weight_lbs', s2.weight_lbs,
                      'duration_min', s2.duration_min, 'distance_mi', s2.distance_mi, 'rpe', s2.rpe)
                    order by s2.set_number)
             from workout_sets s2 where s2.workout_id = w.id), '[]'::json) as set_detail
    from workouts w
    join workout_sets s on s.workout_id = w.id
    where w.exercise_id = ${meta.id}
    group by w.id, w.entry_date
    order by w.entry_date desc
    limit ${limit}`;

  // Reversed here rather than in SQL: the LIMIT has to take the most RECENT sessions, but a
  // chart has to read oldest-to-newest. Ordering ascending in the query would cap the history
  // at the first 120 sessions ever recorded and then never move again.
  return { exercise: meta, sessions: sessions.slice().reverse() };
}

/**
 * Training by movement pattern, in every unit the work was actually recorded in.
 *
 * The muscle-region version of this has a fan-out trap; this one does not, because `pattern` is
 * a single column on the exercise rather than a many-to-many join. One session counts once.
 *
 * Four measures come back rather than one, because a pattern is not confined to a single kind
 * of work. Core is the clearest case: a weighted cable crunch has tonnage, situps and russian
 * twists are unloaded reps, and a plank is time — the same pattern in one week can legitimately
 * produce all three. Cardio is the same story: a run might be logged with miles, or minutes, or
 * both, and none of those is more correct than the others.
 *
 * Every measure is therefore reported independently and left NULL when it was never recorded.
 * The alternative — folding everything into one number — would need an invented exchange rate
 * between a rep and a minute, and would report the absence of a measure as a zero.
 */
export async function getVolumeByPattern(days = 28) {
  const sql = getSql();
  return sql`
    select coalesce(e.pattern, 'other')          as pattern,
           round(sum(s.reps * s.weight_lbs))     as volume_lbs,
           -- Reps done WITHOUT external load, kept apart from the tonnage above so a set of
           -- situps and a set of weighted crunches are not added together into a number that
           -- means neither. Sets carrying weight already count in volume_lbs.
           sum(s.reps) filter (where s.weight_lbs is null or s.weight_lbs = 0)::int
                                                 as bodyweight_reps,
           count(distinct w.id)::int             as sessions,
           count(distinct w.entry_date)::int     as days,
           round(sum(s.distance_mi), 2)          as distance_mi,
           round(sum(s.duration_min))            as duration_min
    from workouts w
    join exercises e on e.id = w.exercise_id
    join workout_sets s on s.workout_id = w.id
    where w.entry_date >= (now() at time zone ${APP_TIMEZONE})::date - ${days}::int
    group by 1`;
}

/**
 * Week-by-week rollup: training, nutrition and bodyweight side by side.
 *
 * Each metric is aggregated in its own CTE and joined on the week. Aggregating them in one
 * query across joined tables would multiply rows — a day with four meals and three sets
 * would count each meal three times.
 */
export async function getWeeklySummary(weeks = 8) {
  const sql = getSql();

  return sql`
    with bounds as (
      select (now() at time zone ${APP_TIMEZONE})::date - (${weeks}::int * 7 - 1) as from_date,
             (now() at time zone ${APP_TIMEZONE})::date as to_date
    ),
    training as (
      select date_trunc('week', w.entry_date)::date as week,
             count(distinct w.entry_date)::int as training_days,
             count(distinct w.id)::int          as exercises_performed,
             count(s.id)::int                   as total_sets,
             round(sum(s.reps * s.weight_lbs))  as volume_lbs,
             round(sum(s.distance_mi), 1)       as cardio_miles,
             round(sum(s.duration_min))         as cardio_minutes,
             round(avg(s.rpe), 1)               as avg_rpe
      from workouts w
      join workout_sets s on s.workout_id = w.id
      where w.entry_date between (select from_date from bounds) and (select to_date from bounds)
      group by 1
    ),
    nutrition as (
      -- Averaged over days that were actually logged, not over seven. A week with two
      -- logged days should not read as a starvation week.
      select week, round(avg(kcal))    as avg_calories,
                   round(avg(protein)) as avg_protein_g,
                   days_logged
      from (
        select date_trunc('week', m.entry_date)::date as week,
               m.entry_date,
               sum(f.calories  * m.servings) as kcal,
               sum(f.protein_g * m.servings) as protein,
               count(*) over (partition by date_trunc('week', m.entry_date)) as days_logged
        from meals m join foods f on f.id = m.food_id
        where m.entry_date between (select from_date from bounds) and (select to_date from bounds)
        group by 1, 2
      ) d
      group by week, days_logged
    ),
    weight as (
      select date_trunc('week', entry_date)::date as week,
             round(avg(weight_lbs), 1) as avg_weight_lbs,
             count(*)::int as weigh_ins
      from bodyweight
      where entry_date between (select from_date from bounds) and (select to_date from bounds)
      group by 1
    )
    select to_char(wk.week, 'YYYY-MM-DD') as week_starting,
           coalesce(t.training_days, 0)       as training_days,
           coalesce(t.exercises_performed, 0) as exercises_performed,
           coalesce(t.total_sets, 0)          as total_sets,
           t.volume_lbs, t.cardio_miles, t.cardio_minutes, t.avg_rpe,
           n.avg_calories, n.avg_protein_g,
           w.avg_weight_lbs, w.weigh_ins
    from (
      select distinct date_trunc('week', d)::date as week
      from generate_series((select from_date from bounds), (select to_date from bounds), interval '1 day') d
    ) wk
    left join training  t on t.week = wk.week
    left join nutrition n on n.week = wk.week
    left join weight    w on w.week = wk.week
    order by wk.week`;
}

/** Daily calories and macros, for the nutrition chart. */
export async function getDailyNutrition(days = 30) {
  const sql = getSql();
  return sql`
    select m.entry_date::text as date,
           round(sum(f.calories  * m.servings)) as calories,
           round(sum(f.protein_g * m.servings)) as protein_g,
           round(sum(f.carbs_g   * m.servings)) as carbs_g,
           round(sum(f.fat_g     * m.servings)) as fat_g,
           count(*)::int as items
    from meals m join foods f on f.id = m.food_id
    where m.entry_date >= (now() at time zone ${APP_TIMEZONE})::date - ${days}::int
    group by m.entry_date
    order by m.entry_date`;
}

/** Bodyweight with a 7-day rolling average, since day-to-day noise swamps the trend. */
export async function getBodyweightTrend(days = 90) {
  const sql = getSql();
  return sql`
    select entry_date::text as date,
           weight_lbs,
           -- RANGE over an interval, not ROWS. With missed weigh-ins a 6-row window reaches
           -- back however far those rows happen to span — on this history, up to ten days —
           -- so it silently stops being a seven-day average exactly when weighing is
           -- irregular, which is when the smoothing matters most.
           round(avg(weight_lbs) over (
             order by entry_date
             range between interval '6 days' preceding and current row
           ), 1) as rolling_7d,
           count(*) over (
             order by entry_date
             range between interval '6 days' preceding and current row
           )::int as days_in_window
    from bodyweight
    where entry_date >= (now() at time zone ${APP_TIMEZONE})::date - ${days}::int
    order by entry_date`;
}

/**
 * Training volume by muscle region.
 *
 * The fan-out here is the trap: joining sets straight to exercise_muscles multiplies a
 * session's volume by however many muscles the exercise lists, so a squat with two primary
 * leg muscles reports double. Volume is summed per workout FIRST, then attributed to each
 * distinct region the exercise trains. A squat counts once for legs however many leg
 * muscles it names — while a movement spanning two regions still counts for both, which is
 * the behaviour you want.
 */
export async function getVolumeByMuscle(days = 28) {
  const sql = getSql();
  return sql`
    with workout_volume as (
      select w.id, w.exercise_id, sum(s.reps * s.weight_lbs) as volume
      from workouts w join workout_sets s on s.workout_id = w.id
      where s.weight_lbs is not null and s.reps is not null
        and w.entry_date >= (now() at time zone ${APP_TIMEZONE})::date - ${days}::int
      group by w.id, w.exercise_id
    ),
    exercise_regions as (
      select distinct em.exercise_id, m.region, em.role
      from exercise_muscles em join muscles m on m.id = em.muscle_id
    )
    -- Primary and secondary are reported separately rather than blended. Any single number
    -- would need a made-up weighting for how much a secondary muscle really works, and the
    -- honest answer is that it depends on the movement. Splitting them lets the reader
    -- decide, and stops 22 recorded secondary links from being silently discarded.
    select r.region,
           round(sum(v.volume) filter (where r.role = 'primary'))   as primary_volume_lbs,
           round(sum(v.volume) filter (where r.role = 'secondary')) as secondary_volume_lbs,
           count(distinct v.id) filter (where r.role = 'primary')::int   as primary_sessions,
           count(distinct v.id) filter (where r.role = 'secondary')::int as secondary_sessions
    from workout_volume v
    join exercise_regions r on r.exercise_id = v.exercise_id
    group by r.region
    order by primary_volume_lbs desc nulls last`;
}

/**
 * Foods whose macros are guesses, ordered by how much they actually matter.
 *
 * This is the dashboard's review queue. Ranking by total calories contributed rather than
 * by confidence alone puts the effort where it changes the numbers: a low-confidence food
 * eaten twenty times is worth fixing, one eaten once is not.
 */
export async function getReviewQueue(limit = 25) {
  const sql = getSql();
  return sql`
    select f.id, f.name, f.unit_label, f.confidence,
           f.calories, f.protein_g, f.carbs_g, f.fat_g,
           count(m.id)::int                       as times_eaten,
           round(sum(f.calories * m.servings))    as total_calories,
           max(m.entry_date)::text                as last_eaten
    from foods f
    join meals m on m.food_id = f.id
    where f.confidence in ('low', 'medium') or f.calories is null
    group by f.id
    order by (f.confidence = 'low') desc, total_calories desc nulls last
    limit ${limit}`;
}
