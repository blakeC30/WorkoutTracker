import { getSql } from './db';
import { APP_TIMEZONE } from './time';

/**
 * Per-day reads, behind the dashboard's calendar.
 *
 * These differ from everything in stats.ts in kind, not just in shape: stats.ts rolls history
 * up into numbers, while these hand back a day exactly as it was recorded — every set, every
 * dish, and the raw text it was all parsed out of.
 */

/** Guards the date parameter before it reaches a query. */
export function isIsoDate(value: string | null): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * One row per day that has anything on it, for the month grid.
 *
 * Each metric is aggregated in its own CTE and joined on the date. Aggregating across joined
 * tables in one pass would multiply rows — a day with four meals and three sets would count
 * every meal three times.
 *
 * Days with nothing recorded are dropped rather than returned as zeroes. The grid needs every
 * square either way and builds them from the calendar itself; sending 31 rows where 12 have
 * data would just be padding, and a zero is a claim that a blank day does not make.
 */
export async function getCalendar(from: string, to: string) {
  const sql = getSql();

  return sql`
    with days as (
      select d::date as date
      from generate_series(${from}::date, ${to}::date, interval '1 day') d
    ),
    training as (
      -- The patterns array is what the calendar squares and the month matrix are drawn from:
      -- what KIND of session a day was, not how big it was. Volume stays in the payload
      -- because the month total still reports it, but it is no longer the headline.
      select w.entry_date as date,
             count(distinct w.id)::int      as exercises,
             count(s.id)::int               as sets,
             round(sum(s.reps * s.weight_lbs)) as volume_lbs,
             round(sum(s.distance_mi), 2)   as cardio_mi,
             round(sum(s.duration_min))     as cardio_min,
             array_agg(distinct coalesce(e.pattern, 'other')) as patterns
      from workouts w
      join exercises e on e.id = w.exercise_id
      join workout_sets s on s.workout_id = w.id
      where w.entry_date between ${from}::date and ${to}::date
      group by 1
    ),
    food as (
      -- Which meals were logged, not just how many calories. A month view answers "where are
      -- the holes in my logging" better than it answers "how much did I eat", and a missing
      -- lunch is invisible in a calorie total.
      select m.entry_date as date,
             count(*)::int                          as items,
             round(sum(f.calories  * m.servings))   as calories,
             round(sum(f.protein_g * m.servings))   as protein_g,
             array_agg(distinct m.meal_type) filter (where m.meal_type is not null) as meal_types
      from meals m
      join foods f on f.id = m.food_id
      where m.entry_date between ${from}::date and ${to}::date
      group by 1
    ),
    weight as (
      select entry_date as date, weight_lbs
      from bodyweight
      where entry_date between ${from}::date and ${to}::date
    )
    select to_char(days.date, 'YYYY-MM-DD') as date,
           coalesce(t.exercises, 0) as exercises,
           coalesce(t.sets, 0)      as sets,
           t.volume_lbs, t.cardio_mi, t.cardio_min,
           coalesce(t.patterns, '{}') as patterns,
           coalesce(f.items, 0)     as items,
           f.calories, f.protein_g,
           coalesce(f.meal_types, '{}') as meal_types,
           w.weight_lbs
    from days
    left join training t on t.date = days.date
    left join food     f on f.date = days.date
    left join weight   w on w.date = days.date
    where t.date is not null or f.date is not null or w.date is not null
    order by days.date`;
}

/**
 * Training days per calendar month, for the last N months.
 *
 * The one reading in the app that looks past thirty days. Everything else — the month grid, the
 * coverage matrix, the volume charts, the nutrition history — is scoped to a single month or a
 * rolling four weeks, so nothing could answer "am I keeping this up" over a season.
 *
 * Deliberately ONE number per month. The block this replaced carried volume, sets, calories and
 * bodyweight per week, every one of which is reported somewhere else in the app, and the result
 * was the tallest thing on the page saying the least.
 *
 * Months with no training are returned as zero rather than omitted: a gap is the most important
 * thing a consistency view can show, and dropping the row would hide it.
 */
export async function getMonthlyConsistency(months = 6) {
  const sql = getSql();

  return sql`
    with span as (
      select date_trunc('month', (now() at time zone ${APP_TIMEZONE})::date)::date as this_month,
             (now() at time zone ${APP_TIMEZONE})::date as today
    ),
    grid as (
      select generate_series(
               (select this_month from span) - ((${months}::int - 1) * interval '1 month'),
               (select this_month from span),
               interval '1 month')::date as month
    ),
    trained as (
      -- Joined to sets so a workout row with nothing recorded against it cannot count as a
      -- training day, matching how the calendar decides a day was trained.
      select date_trunc('month', w.entry_date)::date as month,
             count(distinct w.entry_date)::int       as training_days
      from workouts w
      join workout_sets s on s.workout_id = w.id
      group by 1
    )
    select to_char(g.month, 'YYYY-MM')      as month,
           coalesce(t.training_days, 0)     as training_days,
           -- Days of that month that have actually happened: all of them once the month is
           -- past, only the elapsed part of the current one. Without this the running month
           -- always looks like a collapse in training.
           case when g.month = (select this_month from span)
                then extract(day from (select today from span))::int
                else extract(day from (g.month + interval '1 month' - interval '1 day'))::int
           end as days_elapsed
    from grid g
    left join trained t on t.month = g.month
    order by g.month`;
}

/**
 * When each movement pattern was last trained, and how long ago.
 *
 * Deliberately NOT derived from the calendar rows the grid already has. If you last trained
 * pull in June and you are looking at August, the August rows contain no evidence of it at all
 * — the answer would come back "never", which is both wrong and the single most alarming thing
 * the screen could say. This searches the whole history instead.
 *
 * Patterns never trained are returned with nulls rather than omitted, because "you have not
 * done this once" is the most useful answer on the strip, not an absence from it.
 */
export async function getPatternRecency() {
  const sql = getSql();

  return sql`
    with patterns(pattern) as (
      -- The five only. This strip answers "what should I train next", and nobody plans to train
      -- "other" — so listing it added a permanent sixth column reading "—", sorted to the front
      -- by the never-trained-first ordering and coloured as overdue. It made the header announce
      -- "1 over a week" about something that had never been done and was not going to be.
      --
      -- Sports are still reported where the question is what HAPPENED rather than what is next:
      -- Today's volume, the coverage matrix, and the exercise's own row.
      values ('push'), ('pull'), ('legs'), ('core'), ('cardio')
    ),
    last_done as (
      select e.pattern, max(w.entry_date) as last_date
      from workouts w
      join exercises e on e.id = w.exercise_id
      where e.pattern is not null
      group by 1
    )
    select p.pattern,
           l.last_date::text as last_date,
           case when l.last_date is null then null
                else ((now() at time zone ${APP_TIMEZONE})::date - l.last_date)::int end as days_since
    from patterns p
    left join last_done l on l.pattern = p.pattern
    -- Longest gap first, never-trained above that: this list is read to decide what to do
    -- next, so it is ordered by what most needs attention rather than by what is freshest.
    order by days_since desc nulls first`;
}

/**
 * Everything recorded for one day: weight, every set of every exercise, every dish, and the
 * journal text it came from.
 *
 * Built as one query with independent subselects rather than four round trips, and nested with
 * json_agg so sets arrive already attached to their exercise instead of being stitched back
 * together in the client.
 *
 * The journal lookup is the part worth reading twice. Journals are found by what they PRODUCED
 * — rows dated this day — never by their own `created_at`. Those are different dates on
 * purpose: saying "yesterday I squatted" writes a workout dated yesterday from a journal
 * stamped today. Matching on created_at would file that session under the wrong day and lose
 * it from this one, so `logged_on` is returned separately and shown when the two disagree.
 */
export async function getDay(date: string) {
  const sql = getSql();

  const rows = await sql`
    select
      ${date}::date::text as date,

      (select json_build_object('weight_lbs', b.weight_lbs, 'notes', b.notes)
       from bodyweight b where b.entry_date = ${date}::date) as bodyweight,

      (select coalesce(json_agg(x order by x.exercise), '[]'::json) from (
         select e.name as exercise, e.category, e.pattern, e.equipment, w.notes,
                coalesce((
                  select json_agg(json_build_object(
                           'set_number',   s.set_number,
                           'reps',         s.reps,
                           'weight_lbs',   s.weight_lbs,
                           'duration_min', s.duration_min,
                           'distance_mi',  s.distance_mi,
                           'rpe',          s.rpe,
                           'notes',        s.notes)
                         order by s.set_number)
                  from workout_sets s where s.workout_id = w.id), '[]'::json) as sets
         from workouts w
         join exercises e on e.id = w.exercise_id
         where w.entry_date = ${date}::date
       ) x) as workouts,

      (select coalesce(json_agg(m order by m.type_order, m.name), '[]'::json) from (
         select me.id, me.meal_type, me.servings, me.note,
                -- Chronological, not alphabetical: ordering by the text would serve dessert
                -- between breakfast and dinner.
                case me.meal_type
                  when 'breakfast' then 1 when 'lunch' then 2 when 'dinner' then 3
                  when 'snack' then 4 when 'dessert' then 5 else 6 end as type_order,
                f.name, f.unit_label, f.confidence, f.source_url,
                f.calories, f.protein_g, f.carbs_g, f.fat_g
         from meals me
         join foods f on f.id = me.food_id
         where me.entry_date = ${date}::date
       ) m) as meals,

      (select coalesce(json_agg(j order by j.logged_on, j.logged_at), '[]'::json) from (
         select jo.id, jo.raw_text, jo.source,
                to_char(jo.created_at at time zone ${APP_TIMEZONE}, 'HH24:MI')     as logged_at,
                to_char(jo.created_at at time zone ${APP_TIMEZONE}, 'YYYY-MM-DD')  as logged_on
         from journals jo
         where jo.id in (
           select journal_id from workouts   where entry_date = ${date}::date and journal_id is not null
           union
           select journal_id from meals      where entry_date = ${date}::date and journal_id is not null
           union
           select journal_id from bodyweight where entry_date = ${date}::date and journal_id is not null
         )
       ) j) as journals`;

  return rows[0];
}
