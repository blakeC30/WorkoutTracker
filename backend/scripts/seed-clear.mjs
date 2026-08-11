#!/usr/bin/env node
//
// Removes every row `npm run seed` created and nothing else.
//
// Deletion order is load-bearing. Meals and workouts reference foods and exercises with
// ON DELETE RESTRICT, so the catalogs cannot go until the logs that point at them are gone.
// And a seeded food might have been eaten in a real, hand-logged meal — that food has to
// stay, or the real meal loses its macros. The catalog step therefore only deletes seeded
// rows that nothing references any more.
//
// Run with:  npm run seed:clear

import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Fill in backend/.env.local first.');
  process.exit(1);
}

const pool = new Pool({ connectionString });

async function main() {
  const client = await pool.connect();
  try {
    const before = await counts(client);

    await client.query('begin');

    // 1. Seeded journals cascade to their workouts, meals and bodyweight — and workouts
    //    cascade on to workout_sets.
    const journals = await del(client, 'delete from journals where is_seed');

    // 2. Any seeded log row that had no journal parent.
    const sets = await del(client, 'delete from workout_sets where is_seed');
    const workouts = await del(client, 'delete from workouts where is_seed');
    const meals = await del(client, 'delete from meals where is_seed');
    const bodyweight = await del(client, 'delete from bodyweight where is_seed');

    // 3. Catalog rows last, and only if unreferenced. A seeded food eaten in a real meal
    //    stays — deleting it would strip that meal of its macros, and RESTRICT would block
    //    it anyway. Leaving it is the correct outcome, not a workaround.
    const foods = await del(client, `
      delete from foods f
      where f.is_seed and not exists (select 1 from meals m where m.food_id = f.id)`);
    const exercises = await del(client, `
      delete from exercises e
      where e.is_seed and not exists (select 1 from workouts w where w.exercise_id = e.id)`);

    await client.query('commit');

    console.log('Removed seeded rows:');
    console.log(`  journals      ${journals}`);
    console.log(`  workouts      ${workouts} (${sets} orphan sets)`);
    console.log(`  meals         ${meals}`);
    console.log(`  bodyweight    ${bodyweight}`);
    console.log(`  foods         ${foods}`);
    console.log(`  exercises     ${exercises}`);

    const after = await counts(client);
    console.log('\nRemaining (your real data):');
    console.table([after]);

    const keptFoods = Number(after.foods_seeded);
    const keptExercises = Number(after.exercises_seeded);
    if (keptFoods || keptExercises) {
      console.log(
        `\nKept ${keptFoods} seeded food(s) and ${keptExercises} seeded exercise(s) still ` +
          `referenced by real entries. Deleting them would strip those entries of their macros.`,
      );
    }
    if (Number(before.total_seeded) > 0 && Number(after.total_seeded) === keptFoods + keptExercises) {
      console.log('All seeded log rows removed.');
    }
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function del(client, sql) {
  const res = await client.query(sql);
  return res.rowCount ?? 0;
}

async function counts(client) {
  const { rows: [r] } = await client.query(`
    select (select count(*) from journals)   as journals,
           (select count(*) from workouts)   as workouts,
           (select count(*) from meals)      as meals,
           (select count(*) from bodyweight) as bodyweight,
           (select count(*) from foods)      as foods,
           (select count(*) from exercises)  as exercises,
           (select count(*) from foods where is_seed)     as foods_seeded,
           (select count(*) from exercises where is_seed) as exercises_seeded,
           (select count(*) from journals where is_seed)
         + (select count(*) from workouts where is_seed)
         + (select count(*) from meals where is_seed)
         + (select count(*) from bodyweight where is_seed)
         + (select count(*) from foods where is_seed)
         + (select count(*) from exercises where is_seed) as total_seeded`);
  return r;
}

main().catch((err) => {
  console.error(`\nSeed clear failed: ${err.message}`);
  process.exit(1);
});
