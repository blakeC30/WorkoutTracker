# End-to-end test of the logging flow

Ten messages to send to the Claude project, in order, against an empty database. Each one is
written the way you would actually type it — none of them tell the model what to do, because
the thing under test is whether the instructions make it do the right thing unprompted.

Each message is a single line in a code block: copy the whole block, paste, send. Verify with
`npm run verify:e2e` in `backend/` after each numbered batch.

## Before you start

> **The live database is production as of 11 August 2026.** It holds real logged training,
> and this suite is written for an empty one — it asserts exact row counts, so real history
> fails it, and running the prompts against it writes test rows you would then have to pick
> out by hand. Point `DATABASE_URL` at a scratch database before running any of this.
> `npm run seed` now refuses outright when it finds real rows; `seed:clear` only ever
> deletes `is_seed` rows, so neither can take real data with it, but the prompts themselves
> have no such guard — they log through Claude exactly like you do.

1. **Remove and re-add the connector.** Schema changes are stacked behind it. Testing
   against a cached tool list tests the old server, and every failure would be a false one.
   Confirm by asking: *"What version does the workout-tracker server report?"* → must be
   **0.8.0**.
2. **Re-paste `prompts/project-instructions.md`** into the project's instructions field.
3. Point the connector and `backend/.env.local` at the scratch database, and confirm it is
   empty: `npm run verify:e2e` should report 22 not-run-yet and nothing passed.

Dates assume **today is Tuesday 11 August 2026**. Saturday = the 8th, Sunday = the 9th,
Thursday = the 6th, Friday = the 7th, yesterday = the 10th. Send them all in one sitting, or
the relative dates drift.

---

## 1 — One message, two dates, a ramp, and a plate

```text
Weighed 207.4 this morning. Saturday I squatted — 135x5, 185x5, then three sets of five at 225. Bench after that, 3x8 at 155. Dinner Saturday was grilled salmon, roasted potatoes and a green salad.
```

**Tests:** one journal holding all three record types · the weigh-in dated **today** while the
training is dated **Saturday**, from a single message · a ramp kept as distinct sets rather
than averaged · "3x8" expanded to three identical rows · a plate split into three dishes ·
`meal_type` set · Title Case names · patterns assigned (legs, push).

**The one to watch:** the ramp. Averaging it to "5 sets at 195" leaves a plausible-looking
total volume and destroys both the top set and the PR.

## 2 — A composite dish, and a food it has already seen

```text
Yesterday: protein shake for breakfast — whole milk, a banana and two scoops of chocolate whey. Lunch was two of those salmon filets again with rice.
```

**Tests:** the shake is **one** row despite three ingredients being named · the salmon is
matched in the catalog rather than re-estimated · `servings: 2` rather than two rows.

**The one to watch:** a second salmon food. It means the model skipped `search_foods`, and
every correction from then on only fixes half the history.

## 3 — Three different units of work in one session

```text
Sunday morning I ran 3.2 miles in 26 minutes. Then pushups, 22 / 18 / 15, and three one-minute planks.
```

**Tests:** the run carries **both** distance and duration in a single set · pushups are reps
with no weight · planks are duration with no reps · plank files under `core`, not `cardio` ·
the run does not claim the legs as primary muscles.

## 4 — Effort reported once, and a sport

Two messages, and they must stay separate — see the note below.

**4a**

```text
Deadlifts Thursday — 225x5, 275x3, then 315 for a single. That single was a real grinder, call it a 9.
```

**4b**

```text
Played basketball for about an hour Friday night.
```

**Tests:** three distinct sets · RPE 9 on the **single only** · basketball as
`category: sport`, `pattern: other` rather than being forced into cardio.

**The one to watch:** RPE on the first two sets. You reported effort on exactly one, so
anything else was invented — and an invented 8 is indistinguishable from a real one once
stored, which makes the whole column worthless.

**Why these are split:** they were one message in the first draft, which made batch 7
untestable. A journal is the unit of undo because it is the unit of provenance — everything
parsed from one message — so "delete the basketball entry" cannot be honoured when the same
message also logged Thursday's deadlifts. That is the system behaving correctly and the test
asking for something incoherent.

## 5 — Case, and correcting a day

Two messages. Send both before verifying.

**5a**

```text
quick one — barbell back squat yesterday, 3x5 at 185
```

**5b**

```text
Correction on Saturday's squats — the last set was 225x3, not 225x5. Everything else was right.
```

**Tests:** the lower-case name matches the existing exercise instead of creating a second one ·
the correction **replaces** Saturday's sets rather than appending, and carries the full list
back rather than only the changed set.

**The one to watch:** ten sets on Saturday instead of five. That is an append, and it doubles
the day's volume.

## 6 — The correction tools

Two messages.

**6a**

```text
The salmon is wrong — the label says 340 calories and 34g protein per filet.
```

**6b**

```text
Rename Bench Press to Barbell Bench Press.
```

**Tests:** `save_food` corrects the food, so both meals already logged with it move · the
rename goes through `save_exercise` and keeps the same row.

**The one to watch:** two bench presses. Logging the new spelling inline upserts on
`lower(name)` and creates a second exercise with half the history — `save_exercise` with an
`exercise_id` is the only path that renames.

## 7 — Undo

```text
Delete the basketball entry.
```

**Tests:** it previews with `confirm: false` and **waits** rather than deleting on the first
call · it deletes the *workout row*, not the journal · the set goes with the workout · the
journal text survives · Basketball stays in the exercise catalog, because deleting a session
is not the same as saying the sport does not exist.

**The one to watch:** deletion without asking you first.

**Also worth watching:** whether it reaches for `journal_id` when a `workout_id` is the right
answer. With 4a and 4b split, this message's basketball has its own journal, so either works.
The sharper version of this test is to send 4a and 4b as ONE message and then ask to delete
only the basketball — the right move is a single `workout_ids` entry, and offering to delete
the whole journal instead would take Thursday's deadlifts with it.

## 8 — Reading, not remembering

```text
What haven't I trained lately, and where is my squat heading?
```

**Tests:** it calls `get_pattern_recency` and `get_exercise_history` rather than answering
from this conversation — which it could, since everything above is in context. The tools are
the record; the conversation is not.

---

## After

`npm run verify:e2e` for the assertions, `npm run verify:e2e -- --dump` to see every row.

Then point `DATABASE_URL` back at production. The test rows live in the scratch database
and can stay there; nothing has to be cleaned up, which is the point of using one.
