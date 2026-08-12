#!/usr/bin/env node
//
// End-to-end verification of the logging contract.
//
// Reads the database and checks what the model actually wrote against what the ten test
// messages in prompts/e2e-test.md should have produced. Run it after each batch:
//
//   npm run verify:e2e
//
// A check that has not happened yet reports PENDING rather than FAIL, so the report is
// meaningful from the first message onwards. PENDING is decided by whether the batch's own
// data is present at all — never by whether the assertion passes, which would let a genuine
// failure hide as "not run yet".
//
// The point of a script rather than eyeballing the dashboard: most of these failures are
// invisible on screen. An invented RPE looks exactly like a real one. A meal split into four
// rows instead of one looks like dinner. A second lower-case "bench press" renders identically
// to the first and quietly halves the history.

import { neon } from '@neondatabase/serverless';
import { getConnectionString, printTarget } from './lib/env.mjs';

// Read-only, so no guard — but it still says which database it read. A green report from the
// wrong database is worse than a red one, and row counts alone will not tell you which.
printTarget('Verifying');

const sql = neon(getConnectionString());

const results = [];
const check = (batch, name, state, detail = '') =>
  results.push({ batch, name, state, detail });

/** A check whose data is not in the database yet. */
const pending = (batch, name) => check(batch, name, 'PENDING');

function expect(batch, name, condition, detail = '') {
  check(batch, name, condition ? 'PASS' : 'FAIL', condition ? '' : detail);
}

const SMALL = new Set(['and', 'with', 'of', 'the', 'on', 'in', 'a', 'to', 'or', 'per']);

/** Title Case: every word capitalised except short joining words that do not lead. */
function badlyCased(name) {
  return name.split(' ').some((word, i) => {
    if (!word || !/^[a-zA-Z]/.test(word)) return false;
    const lower = word[0] === word[0].toLowerCase();
    if (!lower) return false;
    return i === 0 || !SMALL.has(word.toLowerCase());
  });
}

async function main() {
  // ---- raw material -------------------------------------------------------------------
  const exercises = await sql`
    select e.id, e.name, e.category, e.pattern, e.equipment,
           coalesce(json_agg(m.name || ':' || em.role order by m.name)
                    filter (where m.id is not null), '[]') as muscles
    from exercises e
    left join exercise_muscles em on em.exercise_id = e.id
    left join muscles m on m.id = em.muscle_id
    group by e.id order by e.name`;

  const foods = await sql`
    select id, name, unit_label, calories, protein_g, carbs_g, fat_g, confidence, aliases
    from foods order by name`;

  const sets = await sql`
    select w.entry_date::text as date, e.name as exercise, e.pattern,
           s.set_number, s.reps, s.weight_lbs, s.duration_min, s.distance_mi, s.rpe
    from workout_sets s
    join workouts w on w.id = s.workout_id
    join exercises e on e.id = w.exercise_id
    order by w.entry_date, e.name, s.set_number`;

  const meals = await sql`
    select m.entry_date::text as date, m.meal_type, f.name as food, m.servings,
           f.calories, f.protein_g
    from meals m join foods f on f.id = m.food_id
    order by m.entry_date, m.meal_type, f.name`;

  const weights = await sql`
    select entry_date::text as date, weight_lbs from bodyweight order by entry_date`;

  const [{ journals }] = await sql`select count(*)::int as journals from journals`;

  const setsOn = (date, exerciseLike) =>
    sets.filter((s) => s.date === date && s.exercise.toLowerCase().includes(exerciseLike));
  const mealsOn = (date) => meals.filter((m) => m.date === date);
  const exerciseLike = (t) => exercises.filter((e) => e.name.toLowerCase().includes(t));
  const foodLike = (t) => foods.filter((f) => f.name.toLowerCase().includes(t));
  const num = (v) => (v === null || v === undefined ? null : Number(v));

  // ---- batch 1: one message, two dates, a ramp, a 3x5, a plate ------------------------
  const squat8 = setsOn('2026-08-08', 'squat');
  const bench8 = setsOn('2026-08-08', 'bench');
  if (squat8.length === 0 && bench8.length === 0) {
    ['bodyweight dated today, not Saturday', 'squat ramp kept as 5 distinct sets',
      'bench 3x8 written as 3 identical sets', 'dinner split into 3 dishes',
      'squat pattern is legs'].forEach((n) => pending(1, n));
  } else {
    const bw = weights.find((w) => w.date === '2026-08-11');
    expect(1, 'bodyweight dated today, not Saturday',
      bw && Number(bw.weight_lbs) === 207.4,
      `got ${bw ? `${bw.date} ${bw.weight_lbs}` : 'nothing on 2026-08-11'}`);

    // The ramp is the assertion that matters most: averaging it to "5 sets at 195" would
    // destroy both the top set and the tonnage, and the total volume would still look sane.
    //
    // Deliberately blind to the LAST set's rep count, because batch 5b rewrites it from 225x5
    // to 225x3. Pinning the full shape here made this check start passing and then fail later
    // in the run against data that was entirely correct — a test that reports a failure after
    // a successful correction is worse than no test, since the next real failure gets ignored.
    // The rep count of that set is batch 5's assertion; the shape of the ramp is this one's.
    const ramp = squat8.map((s) => `${num(s.weight_lbs)}x${s.reps}`).join(' ');
    const head = squat8.slice(0, 4).map((s) => `${num(s.weight_lbs)}x${s.reps}`).join(' ');
    expect(1, 'squat ramp kept as 5 distinct sets',
      squat8.length === 5 && head === '135x5 185x5 225x5 225x5' &&
        num(squat8[4].weight_lbs) === 225,
      `got: ${ramp || 'none'}`);

    const b = bench8.map((s) => `${num(s.weight_lbs)}x${s.reps}`).join(' ');
    expect(1, 'bench 3x8 written as 3 identical sets',
      b === '155x8 155x8 155x8', `got: ${b || 'none'}`);

    const dinner = mealsOn('2026-08-08').filter((m) => m.meal_type === 'dinner');
    expect(1, 'dinner split into 3 dishes', dinner.length === 3,
      `got ${dinner.length}: ${dinner.map((m) => m.food).join(', ')}`);

    expect(1, 'squat pattern is legs',
      squat8.length > 0 && squat8[0].pattern === 'legs', `got ${squat8[0]?.pattern}`);
  }

  // ---- batch 2: a composite dish is ONE row; a known food is reused -------------------
  const aug10 = mealsOn('2026-08-10');
  if (aug10.length === 0) {
    ['protein shake is one row, not three', 'salmon reused, not re-catalogued',
      'salmon logged as 2 servings'].forEach((n) => pending(2, n));
  } else {
    const breakfast = aug10.filter((m) => m.meal_type === 'breakfast');
    expect(2, 'protein shake is one row, not three', breakfast.length === 1,
      `got ${breakfast.length}: ${breakfast.map((m) => m.food).join(', ')}`);

    // The catalog test. A second salmon row means the model re-estimated instead of
    // searching, and every correction from here on only fixes half the history.
    const salmon = foodLike('salmon');
    expect(2, 'salmon reused, not re-catalogued', salmon.length === 1,
      `${salmon.length} salmon rows: ${salmon.map((f) => f.name).join(' | ')}`);

    const lunchSalmon = aug10.find((m) => m.food.toLowerCase().includes('salmon'));
    expect(2, 'salmon logged as 2 servings',
      lunchSalmon && Number(lunchSalmon.servings) === 2,
      `got ${lunchSalmon ? lunchSalmon.servings : 'no salmon on 2026-08-10'}`);
  }

  // ---- batch 3: three different units of work in one session -------------------------
  const run = setsOn('2026-08-09', 'run');
  const push = setsOn('2026-08-09', 'push');
  const plank = setsOn('2026-08-09', 'plank');
  if (run.length === 0 && push.length === 0 && plank.length === 0) {
    ['run carries BOTH distance and duration', 'run is a single set',
      'pushups are reps with no weight', 'plank is duration with no reps',
      'plank pattern is core, not cardio'].forEach((n) => pending(3, n));
  } else {
    expect(3, 'run carries BOTH distance and duration',
      run.length > 0 && num(run[0].distance_mi) === 3.2 && num(run[0].duration_min) === 26,
      `got ${num(run[0]?.distance_mi)}mi / ${num(run[0]?.duration_min)}min`);
    expect(3, 'run is a single set', run.length === 1, `got ${run.length} sets`);

    const reps = push.map((s) => s.reps).join('/');
    expect(3, 'pushups are reps with no weight',
      reps === '22/18/15' && push.every((s) => num(s.weight_lbs) === null || num(s.weight_lbs) === 0),
      `got ${reps || 'none'}, weights ${push.map((s) => num(s.weight_lbs)).join(',')}`);

    expect(3, 'plank is duration with no reps',
      plank.length === 3 && plank.every((s) => num(s.duration_min) !== null && s.reps === null),
      `${plank.length} sets, durations ${plank.map((s) => num(s.duration_min)).join(',')}`);
    expect(3, 'plank pattern is core, not cardio',
      plank.length > 0 && plank[0].pattern === 'core', `got ${plank[0]?.pattern}`);
  }

  // ---- batch 4: RPE only where stated; sport is its own thing -------------------------
  const dl = setsOn('2026-08-06', 'deadlift');
  const ball = exerciseLike('basketball');
  if (dl.length === 0 && ball.length === 0) {
    ['deadlift is 3 distinct sets', 'RPE 9 on the single only',
      'basketball is category sport', 'basketball pattern is other'].forEach((n) => pending(4, n));
  } else {
    const d = dl.map((s) => `${num(s.weight_lbs)}x${s.reps}`).join(' ');
    expect(4, 'deadlift is 3 distinct sets', d === '225x5 275x3 315x1', `got: ${d || 'none'}`);

    // The invention test. The user reported effort on exactly one set; an RPE on the other
    // two means the model estimated, and an estimated RPE is indistinguishable from a real
    // one once stored — which makes the whole column untrustworthy.
    const rpes = dl.map((s) => num(s.rpe));
    expect(4, 'RPE 9 on the single only',
      rpes.length === 3 && rpes[0] === null && rpes[1] === null && rpes[2] === 9,
      `got [${rpes.join(', ')}]`);

    expect(4, 'basketball is category sport',
      ball.length === 1 && ball[0].category === 'sport', `got ${ball[0]?.category}`);
    expect(4, 'basketball pattern is other',
      ball.length === 1 && ball[0].pattern === 'other', `got ${ball[0]?.pattern}`);
  }

  // ---- batch 5: case-insensitive match, and sets REPLACE ------------------------------
  const squat10 = setsOn('2026-08-10', 'squat');
  if (squat10.length === 0) {
    pending(5, 'lower-case squat matched the existing exercise');
  } else {
    // Migration 007's whole purpose. Two rows here means PR history, the trend sparkline and
    // the calendar's colour for that day all split between rows that look identical on screen.
    const squats = exerciseLike('squat');
    expect(5, 'lower-case squat matched the existing exercise', squats.length === 1,
      `${squats.length} squat rows: ${squats.map((e) => e.name).join(' | ')}`);
  }

  // Gated on batch 5's FIRST message having landed, not on the correction having worked.
  // Gating on the corrected value would let the two ways this fails — the model appending a
  // second copy of the day, or silently not applying the correction at all — both report as
  // "not run yet". Verify after sending both messages in this batch.
  if (squat10.length === 0) {
    pending(5, 'correction replaced the day rather than appending');
  } else {
    const last = squat8.at(-1);
    const shape = squat8.map((s) => `${num(s.weight_lbs)}x${s.reps}`).join(' ');
    expect(5, 'correction replaced the day rather than appending',
      squat8.length === 5 && last && `${num(last.weight_lbs)}x${last.reps}` === '225x3',
      `${squat8.length} sets: ${shape} — 10 sets means it appended, ` +
        'a trailing 225x5 means the correction never landed');
  }

  // ---- batch 6: the correction tools --------------------------------------------------
  const salmonRow = foodLike('salmon')[0];
  if (!salmonRow || num(salmonRow.calories) !== 340) {
    pending(6, 'salmon macros corrected everywhere at once');
  } else {
    expect(6, 'salmon macros corrected everywhere at once',
      num(salmonRow.calories) === 340 && num(salmonRow.protein_g) === 34,
      `got ${num(salmonRow.calories)}kcal / ${num(salmonRow.protein_g)}p`);
  }

  const benches = exerciseLike('bench');
  if (!benches.some((e) => e.name === 'Barbell Bench Press')) {
    pending(6, 'bench renamed in place, not duplicated');
  } else {
    // save_exercise exists for exactly this. Doing it by logging the new spelling inline
    // would upsert on lower(name) and leave TWO bench presses with half the history each.
    expect(6, 'bench renamed in place, not duplicated', benches.length === 1,
      `${benches.length} bench rows: ${benches.map((e) => `#${e.id} ${e.name}`).join(' | ')}`);
  }

  // ---- batch 7: deletion --------------------------------------------------------------
  //
  // Checks the SETS, not the catalog. Basketball stays in `exercises` forever — deleting a
  // session is not the same as saying the sport never existed, and the catalog is not a log.
  // Gating on the catalog row disappearing would leave this permanently pending.
  const ballSets = sets.filter((s) => s.exercise.toLowerCase().includes('basketball'));
  if (ballSets.length > 0) {
    pending(7, 'basketball session removed, journal text kept');
  } else if (ball.length > 0) {
    // The catalog entry proves the session was logged at some point, so its absence from the
    // log now is a real deletion rather than a batch that never ran.
    const kept = await sql`
      select count(*)::int as c from journals where raw_text ilike '%basketball%'`;
    expect(7, 'basketball session removed, journal text kept', kept[0].c > 0,
      'the journal text went with it — journals are never supposed to be deleted');
  } else {
    pending(7, 'basketball session removed, journal text kept');
  }

  // ---- invariants: true after every batch ---------------------------------------------
  if (meals.length > 0) {
    const untyped = await sql`select count(*)::int as c from meals where meal_type is null`;
    expect(0, 'every meal has a meal_type', untyped[0].c === 0, `${untyped[0].c} without one`);
  }
  if (exercises.length > 0) {
    const noPattern = exercises.filter((e) => !e.pattern);
    expect(0, 'every exercise has a pattern', noPattern.length === 0,
      noPattern.map((e) => e.name).join(', '));

    const noPrimary = exercises.filter((e) => !e.muscles.some((m) => m.endsWith(':primary')));
    expect(0, 'every exercise has a primary muscle', noPrimary.length === 0,
      noPrimary.map((e) => e.name).join(', '));

    // Cardio naming the legs primary makes every run register as leg training.
    const cardioLegs = exercises.filter(
      (e) => e.pattern === 'cardio' && e.muscles.some((m) => /^(quads|hamstrings|glutes|calves):primary$/.test(m)),
    );
    expect(0, 'cardio is not primarily a leg exercise', cardioLegs.length === 0,
      cardioLegs.map((e) => e.name).join(', '));
  }
  if (foods.length > 0) {
    const noUnit = foods.filter((f) => !f.unit_label);
    expect(0, 'every food has a unit_label', noUnit.length === 0,
      noUnit.map((f) => f.name).join(', '));
  }

  const miscased = [...exercises, ...foods].filter((r) => badlyCased(r.name));
  if (exercises.length + foods.length > 0) {
    expect(0, 'catalog names are Title Case', miscased.length === 0,
      miscased.map((r) => `"${r.name}"`).join(', '));
  }

  // ---- report -------------------------------------------------------------------------
  console.log(`\n${journals} journals · ${exercises.length} exercises · ${foods.length} foods · ` +
    `${sets.length} sets · ${meals.length} meals · ${weights.length} weigh-ins\n`);

  let batch = null;
  for (const r of results.sort((a, b) => a.batch - b.batch)) {
    if (r.batch !== batch) {
      batch = r.batch;
      console.log(batch === 0 ? '\nInvariants' : `\nBatch ${batch}`);
    }
    const mark = { PASS: '  ok  ', FAIL: ' FAIL ', PENDING: '  --  ' }[r.state];
    console.log(`${mark} ${r.name}${r.detail ? `\n         ${r.detail}` : ''}`);
  }

  const failed = results.filter((r) => r.state === 'FAIL').length;
  const passed = results.filter((r) => r.state === 'PASS').length;
  const waiting = results.filter((r) => r.state === 'PENDING').length;
  console.log(`\n${passed} passed, ${failed} failed, ${waiting} not run yet\n`);

  if (process.argv.includes('--dump')) {
    console.log('exercises:'); console.table(exercises.map(({ muscles, ...e }) => ({ ...e, muscles: muscles.join(' ') })));
    console.log('foods:'); console.table(foods.map(({ aliases, ...f }) => f));
    console.log('sets:'); console.table(sets.map((s) => ({ ...s, weight_lbs: num(s.weight_lbs) })));
    console.log('meals:'); console.table(meals);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\nVerification failed to run: ${err.message}`);
  process.exit(2);
});
