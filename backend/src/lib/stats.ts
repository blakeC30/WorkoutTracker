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
      select e.id as exercise_id, e.name as exercise, e.category,
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
    select m.exercise, m.category,
           case when h.exercise_id is not null then 'weighted' else 'endurance' end as record_type,
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
           max(m.entry_date)::text as last_performed
    from matched m
    left join heaviest  h  on h.exercise_id  = m.exercise_id
    left join best_e1rm b  on b.exercise_id  = m.exercise_id
    left join endurance en on en.exercise_id = m.exercise_id
    group by m.exercise, m.category, h.exercise_id, h.weight_lbs, h.reps, h.entry_date,
             b.e1rm, b.weight_lbs, b.reps, b.entry_date,
             en.best_distance_mi, en.best_duration_min, en.best_pace_min_per_mi
    order by max(m.entry_date) desc
    limit ${limit}`;
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
