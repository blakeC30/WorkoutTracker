-- 001_init.sql — initial schema
--
-- journals holds the raw text of everything logged. The other three tables hold the
-- structured data parsed out of it and link back to their origin via journal_id.
--
-- is_seed marks rows created by `npm run seed` so `npm run seed:clear` can remove all of
-- them without touching real data.

create table if not exists journals (
  id           bigint generated always as identity primary key,
  raw_text     text not null,
  source       text not null check (source in ('mcp', 'web')),
  parsed_json  jsonb,
  is_seed      boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists workouts (
  id           bigint generated always as identity primary key,
  journal_id   bigint references journals(id) on delete cascade,
  entry_date   date not null,
  exercise     text not null,
  category     text,
  sets         integer,
  reps         integer,
  weight_lbs   numeric(6,2),
  duration_min numeric(6,2),
  rpe          numeric(3,1),
  notes        text,
  is_seed      boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists bodyweight (
  id          bigint generated always as identity primary key,
  journal_id  bigint references journals(id) on delete cascade,
  entry_date  date not null unique,
  weight_lbs  numeric(6,2),
  notes       text,
  is_seed     boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists meals (
  id          bigint generated always as identity primary key,
  journal_id  bigint references journals(id) on delete cascade,
  entry_date  date not null,
  description text,
  calories    integer,
  protein_g   integer,
  carbs_g     integer,
  fat_g       integer,
  confidence  text check (confidence in ('high', 'medium', 'low')),
  is_seed     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- One workout row per exercise per day. log_entry upserts on this constraint, so logging
-- the same exercise twice in one day corrects the row rather than duplicating it.
create unique index if not exists workouts_date_exercise_uniq
  on workouts (entry_date, exercise);

-- No standalone entry_date index on workouts or bodyweight on purpose: Postgres can use
-- the leftmost column of workouts_date_exercise_uniq by itself, and bodyweight.entry_date
-- is already indexed by its unique constraint. exercise is not leftmost, so it needs one.
create index if not exists workouts_exercise_idx   on workouts (exercise);
create index if not exists workouts_journal_id_idx on workouts (journal_id);

create index if not exists bodyweight_journal_id_idx on bodyweight (journal_id);

create index if not exists meals_entry_date_idx   on meals (entry_date);
create index if not exists meals_journal_id_idx   on meals (journal_id);

create index if not exists journals_created_at_idx on journals (created_at);
