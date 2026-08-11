-- 006_exercise_pattern.sql
--
-- Adds the movement pattern to `exercises`: push, pull, legs, core, cardio.
--
-- This deliberately lives on the EXERCISE and not on the muscle, because the pattern is a
-- property of the movement rather than of the tissue doing the work. A bench press is a push
-- even though the triceps are heavily involved; a curl is a pull even though it is the same
-- arm. Deriving push/pull from muscles would put both of those in the same bucket and get both
-- of them wrong.
--
-- It is also distinct from `category`, which answers "what kind of training is this"
-- (strength / cardio / mobility / sport). `pattern` answers "what did this session work", which
-- is the question a calendar is actually being asked.
--
-- `region` on muscles stays as it is. The two live at different grains on purpose: pattern is
-- how sessions get planned, region is how volume gets counted.

alter table exercises
  add column if not exists pattern text
    check (pattern in ('push', 'pull', 'legs', 'core', 'cardio', 'other'));

-- Backfill from what is already known. Order matters: the first matching rule wins, so cardio
-- is settled before anything looks at muscles, and the arms split is decided by the movement's
-- name rather than by biceps-vs-triceps — which is the whole point of the column.
update exercises e
set pattern = case
  when e.category = 'cardio' then 'cardio'

  -- Named movements first. These are the cases a muscle-based rule would get wrong.
  when e.name ~* '(bench|overhead press|shoulder press|push[- ]?up|dip|pushdown|extension|fly)' then 'push'
  when e.name ~* '(row|pulldown|pull[- ]?up|chin[- ]?up|curl|shrug|face pull)'                  then 'pull'
  when e.name ~* '(squat|deadlift|lunge|leg press|leg curl|leg extension|calf|hip thrust)'      then 'legs'
  when e.name ~* '(plank|crunch|sit[- ]?up|hollow|dead ?bug|ab wheel|russian twist)'            then 'core'

  -- Fall back to the primary muscles for anything the names missed.
  when exists (
    select 1 from exercise_muscles em join muscles m on m.id = em.muscle_id
    where em.exercise_id = e.id and em.role = 'primary' and m.region = 'legs') then 'legs'
  when exists (
    select 1 from exercise_muscles em join muscles m on m.id = em.muscle_id
    where em.exercise_id = e.id and em.role = 'primary' and m.region = 'back') then 'pull'
  when exists (
    select 1 from exercise_muscles em join muscles m on m.id = em.muscle_id
    where em.exercise_id = e.id and em.role = 'primary' and m.region in ('chest', 'shoulders')) then 'push'
  when exists (
    select 1 from exercise_muscles em join muscles m on m.id = em.muscle_id
    where em.exercise_id = e.id and em.role = 'primary' and m.region = 'core') then 'core'

  else 'other'
end
where e.pattern is null;

-- The calendar groups a whole month by this, so it is worth an index once there are more than
-- a handful of exercises.
create index if not exists exercises_pattern_idx on exercises (pattern);
