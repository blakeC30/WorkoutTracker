-- 005_exercises_and_sets.sql
--
-- Gives workouts the same catalog treatment meals got: `exercises` holds facts about the
-- movement, `workouts` records that it was done on a day, and `workout_sets` records how it
-- actually went.
--
-- The analogy to foods/meals is close but not exact, and the difference matters. Macros left
-- meals because they are a property of the food. Reps and weight are properties of the
-- PERFORMANCE, not the exercise, so they do not move to the catalog — they move DOWN, into
-- per-set rows. Only `category` leaves workouts, because it describes the movement.
--
-- Per-set rows exist because "3x5 at 225" and "225x5, 245x3, 265x1" are different sessions
-- that the old shape recorded identically. A real PR is the best single set, and real volume
-- is the sum over sets — neither is recoverable from a flattened row.

-- 1. Exercise catalog -------------------------------------------------------------------

create table if not exists exercises (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  aliases    text[] not null default '{}',
  category   text check (category in ('strength', 'cardio', 'mobility', 'sport', 'other')),
  equipment  text,
  notes      text,
  is_seed    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Muscles, normalized ----------------------------------------------------------------
--
-- A lookup table rather than a text[] on exercises, so "quads" and "quad" can't drift apart.
-- `region` is the coarse grouping charts will actually roll up to.

create table if not exists muscles (
  id     bigint generated always as identity primary key,
  name   text not null unique,
  region text not null check (region in ('legs', 'back', 'chest', 'shoulders', 'arms', 'core', 'full body'))
);

insert into muscles (name, region) values
  ('quads', 'legs'), ('hamstrings', 'legs'), ('glutes', 'legs'), ('calves', 'legs'),
  ('adductors', 'legs'), ('abductors', 'legs'),
  ('lats', 'back'), ('traps', 'back'), ('rhomboids', 'back'), ('lower back', 'back'),
  ('chest', 'chest'),
  ('front delts', 'shoulders'), ('side delts', 'shoulders'), ('rear delts', 'shoulders'),
  ('biceps', 'arms'), ('triceps', 'arms'), ('forearms', 'arms'),
  ('abs', 'core'), ('obliques', 'core'),
  ('cardiovascular', 'full body')
on conflict (name) do nothing;

create table if not exists exercise_muscles (
  exercise_id bigint not null references exercises(id) on delete cascade,
  muscle_id   bigint not null references muscles(id)   on delete restrict,
  role        text not null check (role in ('primary', 'secondary')),
  primary key (exercise_id, muscle_id)
);

create index if not exists exercise_muscles_muscle_idx on exercise_muscles (muscle_id);

-- 3. workouts point at an exercise -------------------------------------------------------

alter table workouts
  -- RESTRICT, not CASCADE: deleting an exercise that has been performed would erase the
  -- history of performing it. Rename or correct the exercise instead.
  add column if not exists exercise_id bigint references exercises(id) on delete restrict;

-- Catalog every exercise already logged, carrying its category across.
insert into exercises (name, category)
select distinct on (lower(btrim(exercise))) btrim(exercise), category
from workouts
where exercise is not null and btrim(exercise) <> ''
order by lower(btrim(exercise)), id
on conflict (name) do nothing;

update workouts w
set exercise_id = e.id
from exercises e
where w.exercise_id is null and lower(e.name) = lower(btrim(w.exercise));

-- 4. Per-set detail ----------------------------------------------------------------------

create table if not exists workout_sets (
  id           bigint generated always as identity primary key,
  workout_id   bigint not null references workouts(id) on delete cascade,
  set_number   integer not null,
  reps         integer,
  weight_lbs   numeric(6,2),
  -- Cardio lives here too, as a single set. Keeping one shape for everything means volume
  -- and PR queries don't need to special-case it.
  duration_min numeric(6,2),
  distance_mi  numeric(6,2),
  rpe          numeric(3,1),
  notes        text,
  is_seed      boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (workout_id, set_number)
);

create index if not exists workout_sets_workout_idx on workout_sets (workout_id);

-- Expand each existing workout into set rows. A row recording "3 sets of 5 at 225" becomes
-- three identical sets — the best that can be recovered, and honest about what was known.
insert into workout_sets (workout_id, set_number, reps, weight_lbs, duration_min, distance_mi, rpe)
select w.id, s.n, w.reps, w.weight_lbs,
       case when s.n = 1 then w.duration_min end,
       case when s.n = 1 then w.distance_mi end,
       w.rpe
from workouts w
cross join lateral generate_series(1, greatest(coalesce(w.sets, 1), 1)) as s(n)
where not exists (select 1 from workout_sets ws where ws.workout_id = w.id);

-- 5. Retire the flattened columns --------------------------------------------------------

drop index if exists workouts_date_exercise_uniq;
drop index if exists workouts_exercise_idx;

alter table workouts
  drop column if exists exercise,
  drop column if exists category,
  drop column if exists sets,
  drop column if exists reps,
  drop column if exists weight_lbs,
  drop column if exists duration_min,
  drop column if exists distance_mi,
  drop column if exists rpe;

-- One workout row per exercise per day, unchanged in spirit — now keyed on the catalog id
-- rather than a free-text name that only stayed consistent because of a lowercase transform.
create unique index if not exists workouts_date_exercise_uniq
  on workouts (entry_date, exercise_id);

create index if not exists workouts_exercise_id_idx on workouts (exercise_id);

-- 6. Search ------------------------------------------------------------------------------

create index if not exists exercises_name_trgm_idx on exercises using gin (name gin_trgm_ops);
create index if not exists exercises_aliases_idx   on exercises using gin (aliases);
