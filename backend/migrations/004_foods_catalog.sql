-- 004_foods_catalog.sql
--
-- Turns `recipes` into a general food catalog and makes it the single source of macro
-- truth. Everything eaten gets a row — a cup of green beans as much as a Nobu recipe — so
-- macros are worked out once per food instead of re-estimated at every meal.
--
-- Three shape changes:
--   1. recipes -> foods, with per-UNIT macros and a unit_label ('filet', 'cup', 'scoop')
--   2. meals lose their macro columns entirely and point at a food instead
--   3. servings moves to meals, where it means "how much was eaten". It previously lived on
--      recipes meaning "how much the recipe yields" — the same word for two different
--      things, which was a mistake.
--
-- This deliberately reverses the copy-at-log-time rule from 003. Macros are now READ THROUGH
-- the link, so correcting a food's numbers updates every meal ever logged with it. That is
-- the point: fix green beans once and the whole history is right. The cost is that a day's
-- totals are no longer frozen — they reflect the best current understanding of what those
-- foods contain, not what was believed on the day.

create extension if not exists pg_trgm;

-- 1. recipes -> foods -------------------------------------------------------------------

alter table recipes rename to foods;
alter index if exists recipes_name_idx rename to foods_name_idx;

alter table foods
  -- What one serving IS. Without this "300 calories per serving" is ambiguous — per filet?
  -- per cup? The unit is what makes servings on the meal meaningful.
  add column if not exists unit_label text not null default 'serving',
  -- Short names to match on: "black cod" should find "nobu miso black cod".
  add column if not exists aliases text[] not null default '{}',
  -- How well the macros are known. This belongs on the food, not the meal: fix the food
  -- once and every meal using it is fixed. That's what makes a review queue worth having.
  add column if not exists confidence text
    check (confidence in ('high', 'medium', 'low'));

-- `servings` on recipes meant yield. Meals now carry servings eaten, so this is retired.
alter table foods drop column if exists servings;

-- 2. meals point at foods ---------------------------------------------------------------

alter table meals
  -- ON DELETE RESTRICT, not SET NULL. Macros now live only in foods, so deleting a food
  -- that has been eaten would leave meals with no macros at all. A food that is in use
  -- cannot be deleted; rename or correct it instead.
  add column if not exists food_id bigint references foods(id) on delete restrict,
  add column if not exists note text;

-- Carry over meals that were already linked to a recipe.
update meals set food_id = recipe_id where recipe_id is not null and food_id is null;

-- Catalog every meal that was never linked — the sides and one-offs. Their description
-- becomes the food name and their macros become that food's per-unit macros.
insert into foods (name, unit_label, calories, protein_g, carbs_g, fat_g, confidence)
select distinct on (lower(btrim(description)))
       btrim(description), 'serving', calories, protein_g, carbs_g, fat_g, confidence
from meals
where food_id is null and description is not null and btrim(description) <> ''
order by lower(btrim(description)), id
on conflict (name) do nothing;

update meals m
set food_id = f.id
from foods f
where m.food_id is null and lower(f.name) = lower(btrim(m.description));

-- Anything logged before servings existed was one serving.
update meals set servings = 1 where servings is null and food_id is not null;

-- Preserve any description text that differed from the food name as a per-meal note.
update meals m
set note = m.description
from foods f
where m.food_id = f.id and m.description is not null and btrim(m.description) <> f.name;

-- 3. Macros leave meals -----------------------------------------------------------------

alter table meals
  drop column if exists calories,
  drop column if exists protein_g,
  drop column if exists carbs_g,
  drop column if exists fat_g,
  drop column if exists confidence,
  drop column if exists recipe_id,
  drop column if exists description;

create index if not exists meals_food_id_idx on meals (food_id);

-- 4. Search -----------------------------------------------------------------------------
--
-- Trigram indexes make similarity() and ILIKE '%term%' fast, so "cod", "black cod" and a
-- typo like "blak cod" all find "nobu miso black cod". The aliases array is the explicit
-- override for shortcuts that similarity alone would not catch.

create index if not exists foods_name_trgm_idx on foods using gin (name gin_trgm_ops);
create index if not exists foods_aliases_idx   on foods using gin (aliases);
