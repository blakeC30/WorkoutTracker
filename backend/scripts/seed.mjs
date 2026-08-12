#!/usr/bin/env node
//
// Generates roughly eight weeks of plausible training history so the dashboard and the
// programming agent have something real-shaped to develop against.
//
// Every row it writes is marked is_seed = true, and `npm run seed:clear` removes exactly
// those rows. Nothing here touches data logged through Claude.
//
// Plausible matters more than pretty. Real history has missed weeks, sessions that go
// backwards, bodyweight that wobbles rather than sliding, and meals that were guessed at.
// A tidy upward line would make the Phase 5 agent look far better than it deserves.
//
// Run with:  npm run seed

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Fill in backend/.env.local first.');
  process.exit(1);
}

const WEEKS = 8;
const TZ = 'America/Chicago';

// Deterministic PRNG. A fixed seed means re-running produces the same history, so a chart
// that looks wrong can be investigated instead of vanishing on the next run.
let rngState = 20260810;
function rand() {
  rngState = (rngState * 1664525 + 1013904223) % 4294967296;
  return rngState / 4294967296;
}
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const between = (lo, hi) => lo + rand() * (hi - lo);
const chance = (p) => rand() < p;
const round5 = (n) => Math.round(n / 5) * 5;

// --- catalogs -----------------------------------------------------------------------------

const EXERCISES = [
  { name: 'barbell back squat',    category: 'strength', pattern: 'legs', equipment: 'barbell',    primary: ['quads', 'glutes'],   secondary: ['hamstrings', 'lower back'], aliases: ['squat', 'back squat'] },
  { name: 'barbell bench press',   category: 'strength', pattern: 'push', equipment: 'barbell',    primary: ['chest'],             secondary: ['triceps', 'front delts'],   aliases: ['bench', 'bench press'] },
  { name: 'conventional deadlift', category: 'strength', pattern: 'legs', equipment: 'barbell',    primary: ['hamstrings', 'glutes'], secondary: ['lower back', 'traps'],   aliases: ['deadlift', 'dl'] },
  { name: 'overhead press',        category: 'strength', pattern: 'push', equipment: 'barbell',    primary: ['front delts'],       secondary: ['triceps', 'side delts'],    aliases: ['ohp', 'shoulder press'] },
  { name: 'barbell row',           category: 'strength', pattern: 'pull', equipment: 'barbell',    primary: ['lats', 'rhomboids'], secondary: ['biceps'],                   aliases: ['bb row'] },
  { name: 'romanian deadlift',     category: 'strength', pattern: 'legs', equipment: 'barbell',    primary: ['hamstrings'],        secondary: ['glutes', 'lower back'],     aliases: ['rdl'] },
  { name: 'incline dumbbell press',category: 'strength', pattern: 'push', equipment: 'dumbbell',   primary: ['chest'],             secondary: ['front delts', 'triceps'],   aliases: ['incline press'] },
  { name: 'lat pulldown',          category: 'strength', pattern: 'pull', equipment: 'machine',    primary: ['lats'],              secondary: ['biceps'],                   aliases: ['pulldown'] },
  { name: 'leg press',             category: 'strength', pattern: 'legs', equipment: 'machine',    primary: ['quads'],             secondary: ['glutes'],                   aliases: [] },
  { name: 'dumbbell curl',         category: 'strength', pattern: 'pull', equipment: 'dumbbell',   primary: ['biceps'],            secondary: ['forearms'],                 aliases: ['curls'] },
  { name: 'cable tricep pushdown', category: 'strength', pattern: 'push', equipment: 'cable',      primary: ['triceps'],           secondary: [],                           aliases: ['pushdown'] },
  { name: 'plank',                 category: 'strength', pattern: 'core', equipment: 'bodyweight', primary: ['abs'],               secondary: ['obliques'],                 aliases: [] },
  // Cardio: cardiovascular is primary — the legs work, but conditioning is the point.
  { name: 'treadmill run',         category: 'cardio', pattern: 'cardio',   equipment: 'treadmill',  primary: ['cardiovascular'],    secondary: ['quads', 'calves'],          aliases: ['run', 'treadmill'] },
  { name: 'stationary bike',       category: 'cardio', pattern: 'cardio',   equipment: 'bike',       primary: ['cardiovascular'],    secondary: ['quads'],                    aliases: ['bike'] },
  // Sport: no pattern of its own, so it lands in the catch-all the dashboard calls
  // "Sport & other". Occasional by design — a weekend game, not a training block.
  { name: 'basketball',            category: 'sport',    pattern: 'other', equipment: 'none',       primary: ['cardiovascular'],    secondary: ['quads', 'calves'],          aliases: ['hoops', 'pickup'] },
  { name: 'tennis',                category: 'sport',    pattern: 'other', equipment: 'racquet',    primary: ['cardiovascular'],    secondary: ['quads', 'side delts'],      aliases: [] },

  { name: 'rowing machine',        category: 'cardio', pattern: 'cardio',   equipment: 'machine',    primary: ['cardiovascular'],    secondary: ['lats', 'quads'],            aliases: ['rower', 'erg'] },
];

const FOODS = [
  { name: 'whey protein shake',      unit: 'shake',    kcal: 280, p: 50, c: 8,  f: 4,  conf: 'high',   aliases: ['protein shake', 'shake'] },
  { name: 'oatmeal with berries',    unit: 'bowl',     kcal: 340, p: 12, c: 58, f: 7,  conf: 'medium', aliases: ['oatmeal'] },
  { name: 'scrambled eggs',          unit: 'egg',      kcal: 90,  p: 6,  c: 1,  f: 7,  conf: 'high',   aliases: ['eggs'] },
  { name: 'greek yogurt',            unit: 'cup',      kcal: 150, p: 20, c: 9,  f: 4,  conf: 'high',   aliases: ['yogurt'] },
  { name: 'banana',                  unit: 'banana',   kcal: 105, p: 1,  c: 27, f: 0,  conf: 'high',   aliases: [] },
  { name: 'grilled chicken breast',  unit: 'oz',       kcal: 47,  p: 9,  c: 0,  f: 1,  conf: 'high',   aliases: ['chicken'] },
  { name: 'white rice',              unit: 'cup',      kcal: 205, p: 4,  c: 45, f: 0,  conf: 'high',   aliases: ['rice'] },
  { name: 'sweet potato',            unit: 'medium',   kcal: 180, p: 4,  c: 41, f: 0,  conf: 'medium', aliases: [] },
  { name: 'roasted broccoli',        unit: 'cup',      kcal: 60,  p: 4,  c: 8,  f: 3,  conf: 'medium', aliases: ['broccoli'] },
  { name: 'mixed green salad',       unit: 'serving',  kcal: 120, p: 3,  c: 9,  f: 8,  conf: 'low',    aliases: ['salad'] },
  { name: 'turkey and swiss sandwich', unit: 'sandwich', kcal: 520, p: 34, c: 46, f: 20, conf: 'medium', aliases: ['turkey sandwich'] },
  { name: 'ground beef',             unit: 'oz',       kcal: 71,  p: 7,  c: 0,  f: 5,  conf: 'high',   aliases: ['beef'] },
  { name: 'flour tortilla',          unit: 'tortilla', kcal: 140, p: 4,  c: 24, f: 4,  conf: 'high',   aliases: ['tortilla'] },
  { name: 'black beans',             unit: 'cup',      kcal: 227, p: 15, c: 41, f: 1,  conf: 'medium', aliases: ['beans'] },
  { name: 'salmon fillet',           unit: 'fillet',   kcal: 360, p: 40, c: 0,  f: 22, conf: 'medium', aliases: ['salmon'] },
  { name: 'whole wheat pasta',       unit: 'cup',      kcal: 180, p: 8,  c: 37, f: 2,  conf: 'medium', aliases: ['pasta'] },
  { name: 'marinara sauce',          unit: 'cup',      kcal: 110, p: 3,  c: 18, f: 3,  conf: 'medium', aliases: [] },
  { name: 'peanut butter',           unit: 'tbsp',     kcal: 95,  p: 4,  c: 3,  f: 8,  conf: 'high',   aliases: ['pb'] },
  { name: 'dark chocolate',          unit: 'square',   kcal: 55,  p: 1,  c: 5,  f: 4,  conf: 'medium', aliases: [] },
  { name: 'takeout burrito bowl',    unit: 'bowl',     kcal: 780, p: 42, c: 78, f: 30, conf: 'low',    aliases: ['burrito bowl'] },
  { name: 'beer',                    unit: 'bottle',   kcal: 155, p: 2,  c: 13, f: 0,  conf: 'high',   aliases: [] },
  { name: 'protein bar',             unit: 'bar',      kcal: 210, p: 20, c: 22, f: 7,  conf: 'high',   aliases: [] },
];

// Four-day upper/lower split plus conditioning. Main lifts progress; accessories don't.
const SESSIONS = {
  1: { name: 'lower', lifts: ['barbell back squat', 'romanian deadlift', 'leg press'], accessories: ['plank'] },
  2: { name: 'upper', lifts: ['barbell bench press', 'barbell row'], accessories: ['dumbbell curl', 'cable tricep pushdown'] },
  4: { name: 'lower', lifts: ['conventional deadlift', 'barbell back squat'], accessories: ['plank'] },
  5: { name: 'upper', lifts: ['overhead press', 'incline dumbbell press'], accessories: ['lat pulldown', 'dumbbell curl'] },
};

// Starting top-set weights, and how much each lift adds per week when training is going well.
const START = {
  'barbell back squat': 225, 'barbell bench press': 165, 'conventional deadlift': 275,
  'overhead press': 95, 'barbell row': 135, 'romanian deadlift': 185,
  'incline dumbbell press': 50, 'lat pulldown': 120, 'leg press': 270,
  'dumbbell curl': 30, 'cable tricep pushdown': 50,
};
const WEEKLY_GAIN = {
  'barbell back squat': 5, 'conventional deadlift': 5, 'barbell bench press': 2.5,
  'overhead press': 1.5, 'barbell row': 2.5, 'romanian deadlift': 3,
  // Accessories drift far less — a lagging-movement finder should have something to find.
  'incline dumbbell press': 0.6, 'lat pulldown': 1, 'leg press': 4,
  'dumbbell curl': 0.3, 'cable tricep pushdown': 0.4,
};


/**
 * Title Case at insert time, keys stay lower case.
 *
 * The literals above double as lookup keys for SESSIONS, START and WEEKLY_GAIN, so renaming
 * them would mean keeping four lists in sync and would break silently if one drifted. The
 * database gets the display form; the script keeps working in lower case.
 *
 * Title Case, the way a program sheet writes an exercise: "Barbell Back Squat". Short joining
 * words stay lower case unless they lead, which is the difference between title case and
 * capitalising every word — "Oatmeal with Berries", not "Oatmeal With Berries".
 */
const SMALL_WORDS = new Set(['and', 'with', 'of', 'the', 'on', 'in', 'a', 'to', 'or']);

const displayName = (name) =>
  name
    .split(' ')
    .map((word, i) =>
      i > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');

const pool = new Pool({ connectionString });

// The database went live on 11 August 2026 — it holds real logged history now, not a
// development fixture. Fabricated rows are marked is_seed and seed:clear takes them back
// out, but between those two commands they are indistinguishable from real training on
// every chart, every PR, every weekly total. Refuse by default once real rows exist.
async function guardProductionData(client) {
  const { rows: [r] } = await client.query(`
    select (select count(*) from journals   where not is_seed)
         + (select count(*) from workouts   where not is_seed)
         + (select count(*) from meals      where not is_seed)
         + (select count(*) from bodyweight where not is_seed) as real_rows`);
  const realRows = Number(r.real_rows);
  if (realRows === 0 || process.argv.includes('--force')) return;

  console.error(
    `\nRefusing to seed: this database holds ${realRows} real logged row(s).\n\n` +
      `npm run seed writes ${WEEKS} weeks of invented training history. It is marked\n` +
      `is_seed and npm run seed:clear removes exactly those rows — but until then it is\n` +
      `mixed into your PRs, volume totals and calendar as though you had done it.\n\n` +
      `If you want demo data, point DATABASE_URL at a scratch database. To override here,\n` +
      `re-run with: npm run seed -- --force\n`,
  );
  process.exit(1);
}

async function main() {
  const client = await pool.connect();
  try {
    await guardProductionData(client);

    await client.query('begin');

    const { rows: [{ today }] } = await client.query(
      `select (now() at time zone $1)::date as today`, [TZ],
    );
    const end = new Date(today);
    const start = new Date(end);
    start.setDate(start.getDate() - WEEKS * 7 + 1);
    const startMonday = new Date(start);
    startMonday.setDate(startMonday.getDate() - ((startMonday.getDay() + 6) % 7));

    // --- catalogs ---------------------------------------------------------------------
    const exerciseIds = new Map();
    for (const ex of EXERCISES) {
      const { rows } = await client.query(
        // pattern is not optional here. Without it a re-seed recreates every exercise with a
        // null pattern, and the whole dashboard collapses: no bars on Today, no lit calendar
        // slots, every movement filed under "other". coalesce on conflict so a pattern
        // corrected by hand is never overwritten by a re-run.
        `insert into exercises (name, aliases, category, pattern, equipment, is_seed)
         values ($1, $2::text[], $3, $4, $5, true)
         on conflict (lower(name)) do update set
           is_seed = exercises.is_seed,
           pattern = coalesce(exercises.pattern, excluded.pattern)
         returning id`,
        [displayName(ex.name), ex.aliases, ex.category, ex.pattern, ex.equipment],
      );
      const id = Number(rows[0].id);
      exerciseIds.set(ex.name, id);
      for (const [role, names] of [['primary', ex.primary], ['secondary', ex.secondary]]) {
        for (const muscle of names) {
          await client.query(
            `insert into exercise_muscles (exercise_id, muscle_id, role)
             select $1, id, $3 from muscles where name = $2
             on conflict (exercise_id, muscle_id) do update set role = excluded.role`,
            [id, muscle, role],
          );
        }
      }
    }

    const foodIds = new Map();
    for (const fd of FOODS) {
      const { rows } = await client.query(
        `insert into foods (name, unit_label, calories, protein_g, carbs_g, fat_g,
                            aliases, confidence, is_seed)
         values ($1, $2, $3, $4, $5, $6, $7::text[], $8, true)
         on conflict (lower(name)) do update set is_seed = foods.is_seed
         returning id`,
        [displayName(fd.name), fd.unit, fd.kcal, fd.p, fd.c, fd.f, fd.aliases, fd.conf],
      );
      foodIds.set(fd.name, Number(rows[0].id));
    }

    // Two weeks off, so streak and consistency logic has something real to handle. One is a
    // deliberate deload-shaped gap early on; the other is late, like life got in the way.
    const skippedWeeks = new Set([3, 6]);

    let weight = 212;
    let journals = 0, workoutRows = 0, setRows = 0, mealRows = 0, weighIns = 0;

    for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
      const iso = day.toISOString().slice(0, 10);
      // Monday-aligned, matching how any weekly chart will group. Offsetting from the
      // start date instead made a skipped week straddle two ISO weeks and show up as two
      // half-weeks rather than one clean gap.
      const monday = new Date(day);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const weekIndex = Math.round((monday - startMonday) / (7 * 86400000));
      const dow = day.getDay();
      const offWeek = skippedWeeks.has(weekIndex);

      const parts = [];

      // --- bodyweight: a slow drift with real wobble, not a clean line -----------------
      // Trends down while training, drifts back up during the weeks off — which is what
      // makes the trend worth charting rather than just reading the endpoints.
      weight += offWeek ? between(0.05, 0.32) : between(-0.34, 0.06);
      const weighedIn = chance(0.8);
      if (weighedIn) {
        const shown = Math.round((weight + between(-0.6, 0.6)) * 10) / 10;
        parts.push(`weighed ${shown}`);
      }

      // --- training -------------------------------------------------------------------
      const session = SESSIONS[dow];
      const trained = !offWeek && session && chance(0.88);
      const doesCardio = !offWeek && (dow === 3 || dow === 6) && chance(0.7);

      const plannedWorkouts = [];

      if (trained) {
        for (const lift of session.lifts) {
          // Progression with noise: some weeks stall or go backwards, as they do.
          const base = START[lift] + WEEKLY_GAIN[lift] * weekIndex;
          const top = round5(base * between(0.97, 1.02));
          const hard = chance(0.25); // a heavy top single or double
          const sets = hard
            ? [
                { reps: 5, weight_lbs: round5(top * 0.88), rpe: 6.5 },
                { reps: 3, weight_lbs: top, rpe: 8 },
                { reps: 1, weight_lbs: round5(top * 1.08), rpe: between(9, 10) },
              ]
            : Array.from({ length: 3 + (chance(0.3) ? 1 : 0) }, () => ({
                reps: pick([5, 5, 6, 8]),
                weight_lbs: top,
                rpe: between(6.5, 8.5),
              }));
          plannedWorkouts.push({ exercise: lift, sets });
          parts.push(`${lift} ${sets.map((s) => `${s.weight_lbs}x${s.reps}`).join(', ')}`);
        }
        for (const acc of session.accessories) {
          if (acc === 'plank') {
            plannedWorkouts.push({
              exercise: acc,
              sets: Array.from({ length: 3 }, () => ({ duration_min: 1 })),
            });
            parts.push('planks 3x1min');
          } else {
            const w = round5((START[acc] + WEEKLY_GAIN[acc] * weekIndex) * between(0.95, 1.05));
            const sets = Array.from({ length: 3 }, () => ({
              reps: pick([10, 12, 12, 15]), weight_lbs: w, rpe: between(6, 8),
            }));
            plannedWorkouts.push({ exercise: acc, sets });
            parts.push(`${acc} 3x${sets[0].reps} at ${w}`);
          }
        }
      }

      // A weekend game, roughly every other Sunday. Occasional on purpose: it should show up in
      // the catch-all bucket without ever looking like a training block.
      const playsSport = !offWeek && dow === 0 && chance(0.5);
      if (playsSport) {
        const sport = pick(['basketball', 'basketball', 'tennis']);
        const minutes = Math.round(between(45, 100));
        plannedWorkouts.push({
          exercise: sport,
          // Duration only, no distance — you do not measure a pickup game in miles, and the
          // dashboard has to cope with a session that carries just one of the two.
          sets: [{ duration_min: minutes, rpe: between(6, 9) }],
        });
        parts.push(`${sport} ${minutes} min`);
      }

      if (doesCardio) {
        const machine = pick(['treadmill run', 'stationary bike', 'rowing machine']);
        const minutes = Math.round(between(18, 42));
        const miles = machine === 'treadmill run'
          ? Math.round(between(2, 4.5) * 10) / 10
          : machine === 'stationary bike'
            ? Math.round(between(6, 12) * 10) / 10
            : Math.round(between(1.5, 3) * 10) / 10;
        plannedWorkouts.push({
          exercise: machine,
          sets: [{ duration_min: minutes, distance_mi: miles, rpe: between(5, 7.5) }],
        });
        parts.push(`${machine} ${miles} miles in ${minutes} min`);
      }

      // --- meals ----------------------------------------------------------------------
      const plannedMeals = [];
      const addMeal = (type, food, servings) =>
        plannedMeals.push({ type, food, servings: Math.round(servings * 100) / 100 });

      if (chance(0.92)) {
        if (chance(0.5)) addMeal('breakfast', 'oatmeal with berries', 1);
        else { addMeal('breakfast', 'scrambled eggs', pick([2, 3, 3, 4])); addMeal('breakfast', 'banana', 1); }
        if (chance(0.4)) addMeal('breakfast', 'whey protein shake', 1);
      }
      if (chance(0.9)) {
        if (chance(0.3)) addMeal('lunch', 'takeout burrito bowl', 1);
        else if (chance(0.5)) addMeal('lunch', 'turkey and swiss sandwich', 1);
        else {
          addMeal('lunch', 'grilled chicken breast', pick([5, 6, 6, 8]));
          addMeal('lunch', 'white rice', between(0.75, 1.5));
          addMeal('lunch', 'roasted broccoli', 1);
        }
      }
      if (chance(0.95)) {
        const dinner = pick(['salmon', 'beef', 'chicken', 'pasta']);
        if (dinner === 'salmon') { addMeal('dinner', 'salmon fillet', 1); addMeal('dinner', 'sweet potato', 1); addMeal('dinner', 'mixed green salad', 1); }
        else if (dinner === 'beef') { addMeal('dinner', 'ground beef', pick([5, 6, 8])); addMeal('dinner', 'flour tortilla', pick([2, 2, 3])); addMeal('dinner', 'black beans', between(0.5, 1)); }
        else if (dinner === 'chicken') { addMeal('dinner', 'grilled chicken breast', pick([6, 8, 8])); addMeal('dinner', 'white rice', 1); addMeal('dinner', 'roasted broccoli', between(1, 2)); }
        else { addMeal('dinner', 'whole wheat pasta', between(1, 2)); addMeal('dinner', 'marinara sauce', 1); addMeal('dinner', 'mixed green salad', 1); }
      }
      if (trained && chance(0.6)) addMeal('snack', 'whey protein shake', 1);
      if (chance(0.35)) addMeal('snack', pick(['greek yogurt', 'protein bar', 'peanut butter']), chance(0.5) ? 1 : 2);
      if (chance(0.3)) addMeal('dessert', 'dark chocolate', pick([1, 2, 2, 3]));
      if ((dow === 5 || dow === 6) && chance(0.4)) addMeal('snack', 'beer', pick([1, 2]));

      if (plannedWorkouts.length === 0 && plannedMeals.length === 0 && !weighedIn) continue;

      // --- write ----------------------------------------------------------------------
      const rawText = `[seed] ${iso}: ${parts.join('; ') || 'ate normally'}`;
      const { rows: [j] } = await client.query(
        `insert into journals (raw_text, source, is_seed) values ($1, 'mcp', true) returning id`,
        [rawText],
      );
      const journalId = Number(j.id);
      journals += 1;

      if (weighedIn) {
        await client.query(
          `insert into bodyweight (journal_id, entry_date, weight_lbs, is_seed)
           values ($1, $2, $3, true)
           on conflict (entry_date) do update set weight_lbs = excluded.weight_lbs`,
          [journalId, iso, Math.round(weight * 10) / 10],
        );
        weighIns += 1;
      }

      for (const w of plannedWorkouts) {
        const { rows: [wr] } = await client.query(
          `insert into workouts (journal_id, entry_date, exercise_id, is_seed)
           values ($1, $2, $3, true)
           on conflict (entry_date, exercise_id) do update set journal_id = excluded.journal_id
           returning id`,
          [journalId, iso, exerciseIds.get(w.exercise)],
        );
        const workoutId = Number(wr.id);
        workoutRows += 1;
        await client.query('delete from workout_sets where workout_id = $1', [workoutId]);
        let n = 0;
        for (const s of w.sets) {
          n += 1;
          await client.query(
            `insert into workout_sets (workout_id, set_number, reps, weight_lbs,
                                       duration_min, distance_mi, rpe, is_seed)
             values ($1, $2, $3, $4, $5, $6, $7, true)`,
            [
              workoutId, n, s.reps ?? null, s.weight_lbs ?? null, s.duration_min ?? null,
              s.distance_mi ?? null, s.rpe ? Math.round(s.rpe * 10) / 10 : null,
            ],
          );
          setRows += 1;
        }
      }

      for (const m of plannedMeals) {
        await client.query(
          `insert into meals (journal_id, entry_date, meal_type, food_id, servings, is_seed)
           values ($1, $2, $3, $4, $5, true)`,
          [journalId, iso, m.type, foodIds.get(m.food), m.servings],
        );
        mealRows += 1;
      }
    }

    await client.query('commit');

    console.log(`Seeded ${WEEKS} weeks, ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}`);
    console.log(`  journals      ${journals}`);
    console.log(`  workouts      ${workoutRows} (${setRows} sets)`);
    console.log(`  meals         ${mealRows}`);
    console.log(`  weigh-ins     ${weighIns}`);
    console.log(`  exercises     ${EXERCISES.length}`);
    console.log(`  foods         ${FOODS.length}`);
    console.log('\nAll marked is_seed. Remove with: npm run seed:clear');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  process.exit(1);
});
