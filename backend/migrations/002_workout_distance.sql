-- 002_workout_distance.sql
--
-- Cardio had nowhere to record distance. The first real logged session — "walked/ran 3
-- miles on the treadmill" — stored exercise and category but dropped the 3, because every
-- other metric column (sets, reps, weight_lbs, duration_min, rpe) describes lifting.
-- Distance is the number that matters for cardio volume, so it needs a column of its own.
--
-- numeric(6,2) maxes out at 9999.99 miles, which covers any single session.

alter table workouts
  add column if not exists distance_mi numeric(6,2);
