import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getDay, n, n0, type DayDetail, type DayJournal, type DayMeal, type DayWorkout } from '@/lib/backend';
import { Masthead, Section, Rule, Figure, Empty, Fault } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { PATTERNS, patternColor, patternLabel } from '@/lib/patterns';
import { addDays, agoLabel, clock, dayLabel, dec, int, monthKey, monthShape, shortDay, today } from '@/lib/format';

export const dynamic = 'force-dynamic';

const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'];

/**
 * One day, exactly as it was recorded.
 *
 * This is the only screen in the app that shows raw journal text, and the only one that shows
 * individual sets. Everywhere else is a rollup; here nothing is averaged.
 */
export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const result = await getDay(date);

  return (
    <main className="screen">
      <Masthead left={dayLabel(date)} right={agoLabel(date)} />
      <DayNav date={date} />
      {result.ok ? <Body day={result.row} /> : <Fault error={result.error} />}
    </main>
  );
}

/** Step a day at a time, or back up to the month. */
function DayNav({ date }: { date: string }) {
  const previous = addDays(date, -1);
  const next = addDays(date, 1);
  const isFuture = next > today();

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        borderBottom: '1px solid var(--rule)',
        paddingBottom: 8,
      }}
    >
      <Link
        href={`/calendar/${previous}`}
        className="cap pressable"
        style={{ color: 'var(--signal)', minHeight: 44, display: 'flex', alignItems: 'center' }}
      >
        ‹ {shortDay(previous)}
      </Link>
      <Link
        href={`/calendar?m=${monthKey(date)}`}
        className="cap pressable"
        style={{ color: 'var(--ink-dim)', minHeight: 44, display: 'flex', alignItems: 'center', padding: '0 12px' }}
      >
        {monthShape(monthKey(date)).short}
      </Link>
      {isFuture ? (
        <span className="cap" style={{ color: 'var(--ink-faint)', opacity: 0.4 }}>
          {shortDay(next)} ›
        </span>
      ) : (
        <Link
          href={`/calendar/${next}`}
          className="cap pressable"
          style={{ color: 'var(--signal)', minHeight: 44, display: 'flex', alignItems: 'center' }}
        >
          {shortDay(next)} ›
        </Link>
      )}
    </div>
  );
}

function Body({ day }: { day: DayDetail }) {
  const weight = day.bodyweight ? n(day.bodyweight.weight_lbs) : null;
  const empty = !day.bodyweight && day.workouts.length === 0 && day.meals.length === 0;

  if (empty) {
    return <Empty>Nothing recorded on this day. Rest days aren&apos;t logged, so a blank here usually means one.</Empty>;
  }

  return (
    <>
      {weight !== null ? (
        <Reveal>
          <Section label="Bodyweight">
            <Figure value={dec(weight)} unit="LB" count={weight} decimals={1} />
            {day.bodyweight?.notes ? (
              <p style={{ margin: '10px 0 0', color: 'var(--ink-dim)', fontSize: 'var(--t-sm)' }}>
                {day.bodyweight.notes}
              </p>
            ) : null}
          </Section>
        </Reveal>
      ) : null}

      {day.workouts.length > 0 ? (
        <>
          {weight !== null ? <Rule /> : null}
          <Reveal delay={60}>
            <Training workouts={day.workouts} />
          </Reveal>
        </>
      ) : null}

      {day.meals.length > 0 ? (
        <>
          <Rule />
          <Reveal delay={120}>
            <Food meals={day.meals} />
          </Reveal>
        </>
      ) : null}

      {day.journals.length > 0 ? (
        <>
          <Rule />
          <Reveal delay={180}>
            <Journal entries={day.journals} date={day.date} />
          </Reveal>
        </>
      ) : null}
    </>
  );
}

// --- Training ----------------------------------------------------------------------------

function Training({ workouts }: { workouts: DayWorkout[] }) {
  const volume = workouts.reduce(
    (sum, w) => sum + w.sets.reduce((s, set) => s + (set.reps ?? 0) * n0(set.weight_lbs), 0),
    0,
  );
  const sets = workouts.reduce((sum, w) => sum + w.sets.length, 0);

  // What kind of day this was, in the calendar's own order and colours — so the answer matches
  // the square you tapped to get here instead of being re-derived in a different vocabulary.
  const trained = PATTERNS.filter((pattern) =>
    workouts.some((workout) => workout.pattern === pattern.key),
  );

  return (
    <Section label="Training" aside={`${workouts.length} exercises · ${sets} sets`}>
      {trained.length > 0 ? (
        <div className="cap" style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          {trained.map((pattern) => (
            <span
              key={pattern.key}
              style={{ color: pattern.color, borderBottom: `2px solid ${pattern.color}`, paddingBottom: 3 }}
            >
              {pattern.label}
            </span>
          ))}
        </div>
      ) : null}
      {volume > 0 ? <Figure value={int(volume)} unit="LB VOLUME" count={volume} /> : null}
      <div style={{ marginTop: volume > 0 ? 20 : 0 }}>
        {workouts.map((workout) => (
          <Exercise key={workout.exercise} workout={workout} />
        ))}
      </div>
    </Section>
  );
}

function Exercise({ workout }: { workout: DayWorkout }) {
  const volume = workout.sets.reduce((sum, set) => sum + (set.reps ?? 0) * n0(set.weight_lbs), 0);
  const distance = workout.sets.reduce((sum, set) => sum + n0(set.distance_mi), 0);
  const duration = workout.sets.reduce((sum, set) => sum + n0(set.duration_min), 0);

  // ONE set gets marked, not every set tying for the heaviest. Three sets across at 260 would
  // otherwise all light up, which says nothing — the mark is meant to find the best set at a
  // glance. Ties on weight are broken by reps, so 260x8 beats 260x5.
  const topIndex = workout.sets.reduce((best, set, i, all) => {
    const weight = n0(set.weight_lbs);
    const bestWeight = n0(all[best].weight_lbs);
    if (weight > bestWeight) return i;
    if (weight === bestWeight && (set.reps ?? 0) > (all[best].reps ?? 0)) return i;
    return best;
  }, 0);
  const hasLoad = workout.sets.some((set) => n0(set.weight_lbs) > 0);

  // Cardio and timed holds have no volume; falling back to the category would label a plank
  // "strength", which is true and useless. Report what was actually measured.
  const summary =
    volume > 0
      ? `${int(volume)} lb`
      : distance > 0
        ? `${dec(distance, 2)} mi`
        : duration > 0
          ? `${dec(duration, 0)} min`
          : (workout.category ?? '');

  return (
    <div style={{ padding: '12px 0', borderTop: '1px solid var(--rule)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="selectable" style={{ lineHeight: 1.25 }}>
          {workout.exercise}
          <span className="cap" style={{ color: patternColor(workout.pattern), marginLeft: 8 }}>
            {patternLabel(workout.pattern)}
          </span>
        </span>
        <span className="mono" style={{ fontSize: 'var(--t-cap)', color: 'var(--ink-faint)', flexShrink: 0 }}>
          {summary}
        </span>
      </div>

      {/* Every set on its own line. A ramp is the whole point of storing sets separately —
          flattening 135x8, 155x5, 175x3 to an average would destroy both the top set and the
          total, and this is the screen where you go to see exactly what happened. */}
      <div style={{ marginTop: 8 }}>
        {workout.sets.map((set, i) => (
          <SetLine key={set.set_number} set={set} isTop={hasLoad && i === topIndex} />
        ))}
      </div>

      {workout.notes ? (
        <p style={{ margin: '8px 0 0', color: 'var(--ink-dim)', fontSize: 'var(--t-sm)' }}>{workout.notes}</p>
      ) : null}
    </div>
  );
}

function SetLine({ set, isTop }: { set: DayWorkout['sets'][number]; isTop: boolean }) {
  const weight = n(set.weight_lbs);
  const distance = n(set.distance_mi);
  const duration = n(set.duration_min);
  const rpe = n(set.rpe);

  return (
    <div
      className="mono"
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        padding: '3px 0',
        fontSize: 'var(--t-sm)',
      }}
    >
      <span style={{ color: 'var(--ink-faint)', width: 16, fontSize: 'var(--t-cap)' }}>{set.set_number}</span>

      <span style={{ color: isTop ? 'var(--signal)' : 'var(--ink)' }}>
        {weight !== null && set.reps !== null
          ? `${dec(weight, 0)} × ${set.reps}`
          : distance !== null
            ? `${dec(distance, 2)} mi`
            : duration !== null
              ? `${dec(duration, 0)} min`
              : `× ${set.reps ?? '—'}`}
      </span>

      {distance !== null && weight === null && duration !== null ? (
        <span style={{ color: 'var(--ink-dim)' }}>
          {dec(duration, 0)} min · {clock(duration / distance)}/mi
        </span>
      ) : null}

      {rpe !== null ? <span style={{ color: 'var(--ink-faint)' }}>RPE {dec(rpe)}</span> : null}
      {set.notes ? <span style={{ color: 'var(--ink-faint)' }}>{set.notes}</span> : null}
    </div>
  );
}

// --- Food --------------------------------------------------------------------------------

/** Per-unit macros times servings. The food carries the rate; the meal carries the amount. */
function mealTotals(meal: DayMeal) {
  const servings = n(meal.servings) ?? 1;
  return {
    servings,
    calories: n0(meal.calories) * servings,
    protein: n0(meal.protein_g) * servings,
    carbs: n0(meal.carbs_g) * servings,
    fat: n0(meal.fat_g) * servings,
  };
}

function Food({ meals }: { meals: DayMeal[] }) {
  const totals = meals.reduce(
    (sum, meal) => {
      const t = mealTotals(meal);
      return {
        calories: sum.calories + t.calories,
        protein: sum.protein + t.protein,
        carbs: sum.carbs + t.carbs,
        fat: sum.fat + t.fat,
      };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

  const groups = MEAL_ORDER.map((type) => ({
    type,
    items: meals.filter((meal) => meal.meal_type === type),
  }))
    .concat({ type: 'unsorted', items: meals.filter((meal) => !meal.meal_type) })
    .filter((group) => group.items.length > 0);

  return (
    <Section label="Food" aside={`${meals.length} dishes`}>
      <Figure value={int(totals.calories)} unit="KCAL" count={totals.calories} />
      <div className="mono" style={{ marginTop: 10, fontSize: 'var(--t-sm)', color: 'var(--ink-dim)' }}>
        {int(totals.protein)} P · {int(totals.carbs)} C · {int(totals.fat)} F
      </div>

      <div style={{ marginTop: 18 }}>
        {groups.map((group) => (
          <div key={group.type} style={{ marginBottom: 16 }}>
            <div
              className="cap"
              style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--ink-dim)', marginBottom: 6 }}
            >
              <span>{group.type}</span>
              <span style={{ color: 'var(--ink-faint)' }}>
                {int(group.items.reduce((sum, meal) => sum + mealTotals(meal).calories, 0))} kcal
              </span>
            </div>
            {group.items.map((meal) => (
              <Dish key={meal.id} meal={meal} />
            ))}
          </div>
        ))}
      </div>
    </Section>
  );
}

function Dish({ meal }: { meal: DayMeal }) {
  const t = mealTotals(meal);
  const low = meal.confidence === 'low' || meal.calories === null;

  return (
    <div style={{ padding: '8px 0', borderTop: '1px solid var(--rule)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
        <span className="selectable" style={{ fontSize: 'var(--t-sm)', lineHeight: 1.3, minWidth: 0 }}>
          {meal.name}
          {/* Only shown when it isn't 1. "1 serving" on every line is noise; "1.26 cup" is not. */}
          {t.servings !== 1 ? (
            <span className="mono" style={{ color: 'var(--ink-dim)' }}>
              {' '}
              × {dec(t.servings, t.servings % 1 === 0 ? 0 : 2)}
            </span>
          ) : null}
          {meal.unit_label ? (
            <span style={{ color: 'var(--ink-faint)', fontSize: 'var(--t-cap)' }}> / {meal.unit_label}</span>
          ) : null}
        </span>
        <span
          className="mono"
          style={{ fontSize: 'var(--t-sm)', flexShrink: 0, color: low ? 'var(--flag)' : 'var(--ink)' }}
        >
          {int(t.calories)}
        </span>
      </div>
      {/* Macros per dish, on their own line under the name — the same shape the exercise rows
          use, where a name line is followed by its detail. The numbers were already computed
          for the day total above; reporting only calories here made this the one place on a
          page dedicated to showing a day as recorded that summarised instead.
          Already multiplied by servings, so these are what the dish actually contributed. */}
      {meal.calories !== null ? (
        <div
          className="mono"
          style={{ display: 'flex', gap: 10, marginTop: 3, fontSize: 'var(--t-cap)', color: 'var(--ink-faint)' }}
        >
          <span>{int(t.protein)} P</span>
          <span>{int(t.carbs)} C</span>
          <span>{int(t.fat)} F</span>
        </div>
      ) : null}

      {meal.note ? (
        <p style={{ margin: '3px 0 0', color: 'var(--ink-faint)', fontSize: 'var(--t-cap)' }}>{meal.note}</p>
      ) : null}
    </div>
  );
}

// --- Journal -----------------------------------------------------------------------------

/**
 * The raw text this day was parsed out of.
 *
 * Shown last and framed as provenance, because that is what it is: the numbers above are the
 * record, and this is where they came from. Correcting a value in the dashboard never rewrites
 * this text, so the two can legitimately disagree — the stored number is the one that counts.
 */
function Journal({ entries, date }: { entries: DayJournal[]; date: string }) {
  return (
    <Section label="Logged from" aside={`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}>
      {entries.map((entry) => (
        <div key={entry.id} style={{ padding: '12px 0', borderTop: '1px solid var(--rule)' }}>
          <div className="cap" style={{ display: 'flex', gap: 10, color: 'var(--ink-faint)' }}>
            <span>{entry.logged_at}</span>
            <span>{entry.source}</span>
            {/* A journal written on a different day than the one it describes is normal — "yesterday
                I squatted" is stamped today. Saying so is the only way the two dates on this screen
                don't look like a bug. */}
            {entry.logged_on !== date ? (
              <span style={{ color: 'var(--flag)', marginLeft: 'auto' }}>
                written {shortDay(entry.logged_on)}
              </span>
            ) : null}
          </div>
          <p
            className="selectable"
            style={{
              margin: '8px 0 0',
              fontSize: 'var(--t-sm)',
              lineHeight: 1.6,
              color: 'var(--ink-dim)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {entry.raw_text}
          </p>
        </div>
      ))}
    </Section>
  );
}
