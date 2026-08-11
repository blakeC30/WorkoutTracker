-- 007_case_insensitive_names.sql
--
-- Makes catalog names unique WITHOUT REGARD TO CASE, while still storing them exactly as
-- written.
--
-- The bug: both unique indexes were on `name` itself, so "barbell back squat" and "Barbell
-- Back Squat" were two different exercises. Nothing prevented it — the zod transform that was
-- supposed to lowercase exercise names on the way in is defined in schemas.ts and never
-- imported, so that protection has never once run. A split like that is quiet and expensive:
-- PR history, the trend sparkline, and the calendar's pattern for that day all divide between
-- two rows that look identical on screen.
--
-- The fix is deliberately NOT to lowercase on the way in. That destroys information you cannot
-- get back — RDL becomes rdl, McDonald's becomes mcdonald's, EZ bar becomes ez bar — and no
-- display-time capitalisation can reconstruct it, because "title case every word" turns those
-- into Rdl, Mcdonald's and Ez Bar. Case is part of a name. Store it; just don't let it create
-- duplicates.
--
-- If this migration fails on a duplicate key, that is the point: it means two rows already
-- differ only by case and a human has to choose which name survives and repoint the log rows.
-- Failing loudly beats merging them by guess.

-- exercises ------------------------------------------------------------------------------

alter table exercises drop constraint if exists exercises_name_key;

create unique index if not exists exercises_name_lower_uniq on exercises (lower(name));

-- foods ----------------------------------------------------------------------------------
--
-- The constraint is still called recipes_name_key: it was created before 004 renamed the
-- table, and renaming a table does not rename its constraints.

alter table foods drop constraint if exists recipes_name_key;
alter table foods drop constraint if exists foods_name_key;

create unique index if not exists foods_name_lower_uniq on foods (lower(name));

-- The old lower(name) lookup index from 003 is now redundant — the unique index above serves
-- the same lookups and enforces the constraint as well.
drop index if exists recipes_name_idx;
