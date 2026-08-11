-- 009_title_case_catalog_names.sql
--
-- Title case for catalog names: "Barbell Back Squat", not "Barbell back squat".
--
-- 008 used sentence case, applying a general typography rule to a domain that does not follow
-- it. An exercise name is not a fragment of prose — it is the proper name of a movement, and
-- every program sheet and lifting log writes it that way. Food is the same: a menu says
-- "Grilled Chicken Breast".
--
-- Small words stay lower case unless they lead, which is what separates title case from
-- capitalising every word: "Oatmeal with Berries", not "Oatmeal With Berries".
--
-- initcap() is safe HERE and only here. It title-cases, but it also lowercases every letter it
-- does not capitalise — so it turns RDL into Rdl and EZ into Ez.
--
-- It is used because nothing in the catalog is at risk: checked before running, zero rows
-- contain a mid-word capital or an all-caps token. One row does carry a second capital,
-- "Turkey and Swiss sandwich", but that S is word-initial and initcap preserves it.
--
-- Going forward the tools write the case directly, so this should be the last migration that
-- rewrites names en masse. Do not copy it into one.

update exercises set name = initcap(name);
update foods    set name = initcap(name);

-- Restore the small words. Space-delimited on both sides, so a leading "The" or "And" would be
-- left capitalised — correct, since a title's first word always is.
update exercises set name = replace(name, ' And ',  ' and ')  where name like '% And %';
update exercises set name = replace(name, ' With ', ' with ') where name like '% With %';
update exercises set name = replace(name, ' Of ',   ' of ')   where name like '% Of %';
update exercises set name = replace(name, ' The ',  ' the ')  where name like '% The %';
update exercises set name = replace(name, ' On ',   ' on ')   where name like '% On %';
update exercises set name = replace(name, ' In ',   ' in ')   where name like '% In %';
update exercises set name = replace(name, ' A ',    ' a ')    where name like '% A %';

update foods set name = replace(name, ' And ',  ' and ')  where name like '% And %';
update foods set name = replace(name, ' With ', ' with ') where name like '% With %';
update foods set name = replace(name, ' Of ',   ' of ')   where name like '% Of %';
update foods set name = replace(name, ' The ',  ' the ')  where name like '% The %';
update foods set name = replace(name, ' On ',   ' on ')   where name like '% On %';
update foods set name = replace(name, ' In ',   ' in ')   where name like '% In %';
update foods set name = replace(name, ' A ',    ' a ')    where name like '% A %';
