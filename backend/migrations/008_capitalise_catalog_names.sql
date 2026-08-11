-- 008_capitalise_catalog_names.sql
--
-- Capitalises the existing catalog, now that names are stored as written rather than forced
-- into one case.
--
-- SENTENCE case, not Title Case: "Barbell back squat", not "Barbell Back Squat". Title case
-- capitalises words that shouldn't be — "Chicken With Rice", "Turkey And Swiss" — and reads
-- like a product listing. These are names of things you did and ate, and the app writes them in
-- sans beside uppercase mono labels that already do the shouting.
--
-- Deliberately not `initcap()`: that is title case, and it would also LOWERCASE anything already
-- capitalised, so an acronym typed correctly today would come out as Rdl tomorrow. This only
-- touches the first character and leaves everything after it exactly as stored.
--
-- Safe against the unique indexes from 007: changing only the first letter's case leaves
-- lower(name) identical, so no row can collide with another.

update exercises
set name = upper(left(name, 1)) || substr(name, 2)
where name <> upper(left(name, 1)) || substr(name, 2);

update foods
set name = upper(left(name, 1)) || substr(name, 2)
where name <> upper(left(name, 1)) || substr(name, 2);

-- The one proper noun no mechanical rule finds, because it is not the first word. Listed
-- explicitly rather than pretending a general rule exists; anything similar in future is a
-- one-line update here or a rename from the dashboard.
update foods
set name = 'Turkey and Swiss sandwich'
where lower(name) = 'turkey and swiss sandwich';
