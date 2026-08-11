-- 003_meal_types_and_recipes.sql
--
-- Three related changes, all prompted by the first real day of logged meals, where an
-- entire dinner — cod, green beans, sushi rice, and a salad — became one row estimated at
-- 1000 kcal with low confidence.
--
-- 1. meal_type    so a day's eating groups into breakfast / lunch / dinner / snack / dessert
-- 2. one row per component  so sides are separable from the main and can be recombined
-- 3. recipes      so a dish whose macros were worked out once is never re-estimated
--
-- There is deliberately no "meals" parent table. A meal is just the set of rows sharing an
-- (entry_date, meal_type) — a grouping, not an entity. Adding a parent would buy nothing
-- and would mean two rows to delete for every one that matters.

create table if not exists recipes (
  id          bigint generated always as identity primary key,
  name        text not null unique,
  source_url  text,
  servings    numeric(5,2),
  -- Macros are PER SERVING, not per batch. A recipe yielding 4 servings at 520 kcal each
  -- stores 520 and servings = 4, so logging "I had two filets" is servings x per-serving.
  calories    integer,
  protein_g   integer,
  carbs_g     integer,
  fat_g       integer,
  notes       text,
  is_seed     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table meals
  add column if not exists meal_type text
    check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack', 'dessert')),
  -- ON DELETE SET NULL, not CASCADE. Deleting a recipe must never delete the meals eaten
  -- from it — that history happened. The row keeps its copied macros and simply loses the
  -- link back to where they came from.
  add column if not exists recipe_id bigint references recipes(id) on delete set null,
  add column if not exists servings numeric(5,2);

-- Macros are copied onto the meal row at log time and never read back through recipe_id.
-- Refining a recipe changes what you eat NEXT, never what you already ate — the same rule
-- that keeps journal text from re-deriving corrected values.

create index if not exists meals_day_type_idx  on meals (entry_date, meal_type);
create index if not exists meals_recipe_id_idx on meals (recipe_id);
create index if not exists recipes_name_idx    on recipes (lower(name));
