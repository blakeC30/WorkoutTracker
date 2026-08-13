-- 010_duration_seconds.sql
--
-- Stores set duration in WHOLE SECONDS instead of fractional minutes.
--
-- The reason is not precision, it is who does the arithmetic. Everything in this database is
-- written by a language model parsing a sentence, and "held a 40 second plank" had to become
-- `duration_min: 0.67` before it could be stored — a division the model performs, and a lossy
-- one: 0.67 minutes is 40.2 seconds. The MCP instructions already refuse this kind of thing
-- everywhere else, insisting on one row per set rather than "3x5" precisely so that nothing is
-- derived on the way in. Duration was the one field that broke that rule.
--
-- numeric(6,2) minutes also cannot represent thirds. Quarter-minutes are exact — 15, 30, 45,
-- 90 seconds all land — but 20s stored 0.33 and read back 19.8s, and 40s stored 0.67 and read
-- back 40.2s. Integer seconds is exactly representable for both a 45 second hold and a 40
-- minute run, which is the whole span this column has to carry.
--
-- CONVERSION. Existing values are minutes and are multiplied by 60. `round` before the cast
-- rather than after, so 37.5 becomes 2250 rather than being truncated toward zero; numeric
-- rounds half away from zero, which is what you want for a stopwatch reading. A value like
-- 0.67 comes back as 40 seconds — the original 40 recovered, since the error introduced by the
-- old unit is smaller than the second it is being rounded to.
--
-- The old column is DROPPED rather than left in place. A duration_min sitting beside a
-- duration_sec is two units for one measure, which is the state this migration exists to end,
-- and every reader of it is being changed in the same commit.

alter table workout_sets
  add column duration_sec integer;

update workout_sets
   set duration_sec = round(duration_min * 60)::integer
 where duration_min is not null;

alter table workout_sets
  drop column duration_min;

comment on column workout_sets.duration_sec is
  'Whole seconds. A 45 second plank is 45; a 40 minute run is 2400. Never minutes.';
