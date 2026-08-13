import { z } from 'zod';
import { createMcpHandler } from 'mcp-handler';
import {
  getJournalInput,
  getPrsInput,
  getRecentHistoryInput,
  getWeeklySummaryInput,
  getExerciseHistoryInput,
  getVolumeByMuscleInput,
  getVolumeByPatternInput,
  searchExercisesInput,
  searchFoodsInput,
  logEntryInput,
  saveExerciseInput,
  saveFoodInput,
  deleteEntriesInput,
} from './schemas';
import {
  getExerciseHistory,
  getPrs,
  getVolumeByMuscle,
  getVolumeByPattern,
  getWeeklySummary,
} from './stats';
import { getPatternRecency } from './day';
import {
  deleteEntries,
  resolveDeletion,
  getJournal,
  getRecentHistory,
  listMuscles,
  searchExercises,
  searchFoods,
  logEntry,
  saveExercise,
  saveFood,
} from './queries';

/** Every tool returns text; this keeps the shape consistent. */
function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

function json(value: unknown) {
  return text(JSON.stringify(value, null, 2));
}

/**
 * The MCP server. mcp-handler v2 is stateless HTTP only — there is no transport option to
 * choose and no session store, which is exactly why it needs no Redis.
 */
export const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      'log_entry',
      {
        title: 'Log a workout, weight, or meal',
        description:
          'Save one message worth of training data. Pass the user\'s raw text plus whatever ' +
          'you parsed out of it. All three sections are optional and one message can contain ' +
          'all of them — everything from a single message is stored under one journal entry ' +
          'so it can be undone as a unit. Dates are the dates things HAPPENED, which may not ' +
          'be today.',
        inputSchema: logEntryInput,
      },
      async (input) => {
        const result = await logEntry(input, { source: 'mcp' });

        // Plain-English confirmation of exactly what was saved, so a mis-parse is obvious
        // immediately rather than three weeks later in a chart.
        const lines: string[] = [];
        for (const w of result.workouts) {
          const sets = w.setCount === 1 ? '1 set' : `${w.setCount} sets`;
          const added = w.exerciseAdded ? ' [new exercise]' : '';
          // A replace that destroyed existing sets is stated outright, because it is the one
          // outcome here that loses data and the one the user may not have meant. Silence made
          // an accidental overwrite indistinguishable from an ordinary log.
          const fate = w.appended
            ? ' [appended to what was already logged]'
            : w.setsReplaced > 0
              ? ` [REPLACED ${w.setsReplaced} set(s) already logged for this exercise on this ` +
                `date — if that was meant to be additional work, re-log with set_mode: "append"]`
              : '';
          lines.push(
            `  ${w.updated ? 'Updated' : 'Logged'} ${w.exercise}, ${sets} on ${w.entry_date}${added}${fate}`,
          );
        }
        if (result.bodyweight) {
          lines.push(
            `  Bodyweight ${result.bodyweight.weight_lbs} lbs on ${result.bodyweight.entry_date}`,
          );
        }
        for (const m of result.meals) {
          const foodNote = m.food
            ? ` [${m.food.created ? 'new food' : 'known food'} #${m.food.id}]`
            : '';
          lines.push(
            `  ${m.servings} x ${m.description} on ${m.entry_date}${foodNote}`,
          );
        }
        if (lines.length === 0) {
          lines.push('  (journal text only — nothing structured was parsed out of it)');
        }

        return text(
          `Saved as journal #${result.journalId}:\n${lines.join('\n')}\n\n` +
            `To undo this, use undo_entry with journal_id ${result.journalId}.`,
        );
      },
    );

    server.registerTool(
      'get_recent_history',
      {
        title: 'Recent training history',
        description:
          'Return the last N days of workouts, bodyweight and meals as structured JSON. ' +
          'Use this before answering questions about progress, or before suggesting weights ' +
          'for a session, so recommendations are based on what actually happened.',
        inputSchema: getRecentHistoryInput,
      },
      async ({ days }) => json(await getRecentHistory(days)),
    );

    server.registerTool(
      'get_journal',
      {
        title: 'Read back raw journal entries',
        description:
          'Return the raw text of journal entries written in a date range, exactly as it was ' +
          'typed. This is the provenance record — use it to check what was originally said, ' +
          'not to recompute the structured numbers, which may have been corrected since.',
        inputSchema: getJournalInput,
      },
      async ({ start_date, end_date }) => json(await getJournal(start_date, end_date)),
    );

    server.registerTool(
      'delete_entries',
      {
        title: 'Delete logged rows (journals are always kept)',
        description:
          'Remove logged data. Address it EITHER by journal_id — everything one message ' +
          'produced — OR by specific workout_ids / meal_ids / bodyweight_ids from ' +
          'get_recent_history, when only part of a message was wrong. The two can be ' +
          'combined and are unioned.\n\n' +
          'The journal text is NEVER deleted, only the rows parsed from it. The journal is ' +
          'the record of what was said, and it was said; what can be wrong is how it was ' +
          'interpreted, and that is what this removes.\n\n' +
          'ALWAYS call first with confirm: false, show the user exactly what would be ' +
          'removed, and wait for them to say yes. Only then call again with confirm: true. ' +
          'Never pass confirm: true on the first call, even if the user sounds certain. If ' +
          'the preview contains something they did not ask to remove, say so and stop.',
        inputSchema: deleteEntriesInput,
      },
      async ({ journal_id, workout_ids, meal_ids, bodyweight_ids, confirm }) => {
        if (!journal_id && !workout_ids?.length && !meal_ids?.length && !bodyweight_ids?.length) {
          return text(
            'Nothing to delete: pass a journal_id, or ids from get_recent_history. Nothing ' +
              'was changed.',
          );
        }

        const found = await resolveDeletion({
          journal_id, workout_ids, meal_ids, bodyweight_ids,
        });

        if (found.empty) {
          return text(
            'No matching rows — they may already have been deleted. Nothing was changed. ' +
              'Call get_recent_history to see what is actually there.',
          );
        }

        const lines: string[] = [];
        for (const w of found.workouts) {
          const s = w.set_count === 1 ? '1 set' : `${w.set_count} sets`;
          lines.push(`  workout #${w.id}: ${w.exercise}, ${s} on ${w.entry_date}`);
        }
        for (const b of found.bodyweight) {
          lines.push(`  bodyweight #${b.id}: ${b.weight_lbs} lbs on ${b.entry_date}`);
        }
        for (const m of found.meals) {
          lines.push(
            `  meal #${m.id}: ${m.servings} x ${m.food} on ${m.entry_date}` +
              `${m.meal_type ? ` (${m.meal_type})` : ''}`,
          );
        }

        // Named explicitly rather than left implicit: the text survives but stops appearing
        // anywhere in the dashboard, since a day is assembled from the rows recorded against
        // it. Saying so is the difference between a kept record and a lost one.
        const orphanNote = found.orphaned.length === 0 ? '' :
          `\n\nThese journals will be kept but will have nothing recorded from them, so they ` +
          `will no longer appear on any day:\n` +
          found.orphaned.map((o) => `  #${o.id} "${o.raw_text}"`).join('\n');

        if (!confirm) {
          return text(
            `This would permanently delete:\n\n${lines.join('\n')}${orphanNote}\n\n` +
              `The journal text is kept either way. Nothing has been deleted yet — ask the ` +
              `user to confirm, then call delete_entries again with confirm: true.`,
          );
        }

        const n = await deleteEntries(found.ids);
        return text(
          `Deleted:\n\n${lines.join('\n')}\n\n` +
            `${n.workouts} workout(s), ${n.meals} meal(s), ${n.bodyweight} weigh-in(s). ` +
            `Journal text kept.`,
        );
      },
    );
    server.registerTool(
      'get_prs',
      {
        title: 'Personal records',
        description:
          'Best effort per exercise, in whatever unit that exercise is measured in. Each row ' +
          'carries a record_type saying which: "weighted" reports the heaviest set AND the ' +
          'best estimated one-rep max (Epley), because adding reps at the same weight raises ' +
          'the estimate without touching the heaviest set and that is most of what progress ' +
          'looks like; "bodyweight" reports the best single set of reps for unloaded work ' +
          'like push-ups; "endurance" reports the furthest and the longest for cardio and ' +
          'timed holds; "other" covers sport. Read the record_type before reporting a number ' +
          '— the fields that matter differ by row, and the ones that do not apply are null. ' +
          'Sets above 12 reps are excluded from the estimate, where Epley stops meaning ' +
          'anything.',
        inputSchema: getPrsInput,
      },
      async ({ exercise, limit }) => json(await getPrs({ exercise, limit })),
    );

    server.registerTool(
      'get_weekly_summary',
      {
        title: 'Week-by-week summary',
        description:
          'Training days, sets, volume, cardio, average RPE, average calories and protein, ' +
          'and average bodyweight, per week. Weeks with no training appear with zeros ' +
          'rather than being skipped, so gaps are visible. Use this before commenting on ' +
          'trends or consistency — it is the difference between reading the data and ' +
          'guessing at it.',
        inputSchema: getWeeklySummaryInput,
      },
      async ({ weeks }) => json(await getWeeklySummary(weeks ?? 8)),
    );

    server.registerTool(
      'get_volume_by_muscle',
      {
        title: 'Training volume by muscle region',
        description:
          'Volume attributed to each muscle region over a window, for spotting what is ' +
          'being neglected. Volume is summed per session before being attributed, so an ' +
          'exercise naming several muscles in one region is not counted twice.',
        inputSchema: getVolumeByMuscleInput,
      },
      async ({ days }) => json(await getVolumeByMuscle(days ?? 28)),
    );

    server.registerTool(
      'search_exercises',
      {
        title: 'Search the exercise catalog',
        description:
          'Find a movement by name, alias or approximate spelling, with its category and ' +
          'muscle groups. ALWAYS search before logging a workout: if it is catalogued, log ' +
          'against its id so the same movement stays one exercise rather than several ' +
          'spellings. Omit the query to browse everything.',
        inputSchema: searchExercisesInput,
      },
      async ({ query, limit }) => json(await searchExercises(query, limit ?? 10)),
    );

    server.registerTool(
      'list_muscles',
      {
        title: 'Valid muscle names',
        description:
          'The muscle names an exercise can reference, grouped by region. Muscle names are ' +
          'validated against this list — anything else is rejected — so check here before ' +
          'adding a new exercise with primary_muscles or secondary_muscles.',
        inputSchema: z.object({}),
      },
      async () => json(await listMuscles()),
    );

    server.registerTool(
      'search_foods',
      {
        title: 'Search the food catalog',
        description:
          'Find a food by name, alias, or approximate spelling — "black cod" and "cod" both ' +
          'find "nobu miso black cod". ALWAYS search before logging a meal: if a food is ' +
          'already catalogued, log against its id instead of describing it again, and its ' +
          'macros are reused rather than re-estimated. Omit the query to browse everything.',
        inputSchema: searchFoodsInput,
      },
      async ({ query, limit }) => json(await searchFoods(query, limit ?? 10)),
    );

    server.registerTool(
      'save_food',
      {
        title: 'Add or correct a food',
        description:
          'Create a food, or fix an existing one by passing food_id. Macros are PER UNIT of ' +
          'unit_label. Correcting a food updates every meal ever logged with it, because ' +
          'meals store only a pointer and a quantity — so this is how you fix a bad estimate ' +
          'everywhere at once. Normally you do not need this when logging: put a new food ' +
          'inline on the meal instead.',
        inputSchema: saveFoodInput,
      },
      async (input) => {
        const f = await saveFood(input);
        return text(
          `${f.created ? 'Added' : 'Updated'} food #${f.id} "${f.name}". ` +
            `${f.created ? '' : 'Every meal logged with it now reflects these macros.'}`,
        );
      },
    );

    server.registerTool(
      'save_exercise',
      {
        title: 'Add or correct an exercise',
        description:
          'Fix an exercise in the catalog by passing exercise_id: correct its pattern, its ' +
          'muscles, its equipment, or its NAME. Renaming is only possible here — logging the ' +
          'corrected spelling inline creates a second exercise and splits the history in two ' +
          'rather than repairing it. Fields you omit are left alone, except muscles, which ' +
          'REPLACE that role when supplied. You do not need this when logging: a movement ' +
          'that is simply new goes inline on the workout.',
        inputSchema: saveExerciseInput,
      },
      async (input) => {
        const e = await saveExercise(input);
        if (e.created) return text(`Added exercise #${e.id} "${e.name}".`);
        return text(
          `Updated exercise #${e.id} "${e.name}"` +
            (e.renamedFrom ? `, renamed from "${e.renamedFrom}"` : '') +
            '. Every workout ever logged against it now reads this way.',
        );
      },
    );

    server.registerTool(
      'get_pattern_volume',
      {
        title: 'Training volume by movement pattern',
        description:
          'Push / pull / legs / core / cardio over a window — the balance question, and the ' +
          'axis the calendar itself groups days by. Four measures come back separately ' +
          '(tonnage, unloaded reps, miles, minutes) and a measure never recorded is null ' +
          'rather than zero, because a pattern is not confined to one kind of work: a week of ' +
          'core can legitimately contain weighted crunches, unloaded situps and a plank. Do ' +
          'not add them together. Prefer this over get_volume_by_muscle when the question is ' +
          'what has been TRAINED rather than which muscles were worked.',
        inputSchema: getVolumeByPatternInput,
      },
      async ({ days }) => json(await getVolumeByPattern(days ?? 28)),
    );

    server.registerTool(
      'get_pattern_recency',
      {
        title: 'How long since each pattern was trained',
        description:
          'Days since push, pull, legs, core and cardio were each last trained, longest gap ' +
          'first. This is the question to ask before suggesting what to train today. A ' +
          'pattern never trained comes back with nulls rather than being omitted. Searches ' +
          'all history, so a long layoff reports the real gap instead of "never".',
        inputSchema: z.object({}),
      },
      async () => json(await getPatternRecency()),
    );

    server.registerTool(
      'get_exercise_history',
      {
        title: 'One exercise, session by session',
        description:
          'Every session of a single movement in order, with per-session volume, top weight, ' +
          'estimated 1RM and the individual sets. get_prs gives the best ever; this gives the ' +
          'DIRECTION, which is what actually answers "what weight should I use today". Pass ' +
          'the exact catalogued name — search_exercises first. Returns null if no exercise ' +
          'has that name.',
        inputSchema: getExerciseHistoryInput,
      },
      async ({ name, limit }) => {
        const history = await getExerciseHistory(name, limit ?? 120);
        if (!history) {
          return text(
            `No exercise named "${name}". Call search_exercises to find its catalogued name.`,
          );
        }
        return json(history);
      },
    );
  },
  {
    // Bump this whenever the tool list or any inputSchema changes.
    //
    // MCP clients cache tool definitions at connection and never refetch them, so a connector
    // added before a schema change keeps calling the old shape indefinitely — silently, working
    // around fields it cannot see. This string is the only way to tell from a running
    // conversation which vintage the client is actually holding: ask it what the server version
    // is, and if it disagrees with what is deployed, the connector needs removing and re-adding.
    serverInfo: { name: 'workout-tracker', version: '0.10.0' },

    /*
     * These instructions are sent on every connection, and they are the layer that has to
     * carry anything protecting the integrity of the data.
     *
     * There is a second layer — the Claude project instructions in
     * prompts/project-instructions.md — but it applies only inside that one project, while this
     * travels with the connector everywhere. So the split is: rules that keep the database
     * correct live HERE; tone, phrasing and judgment live there. Duplicating a rule across both
     * is how they drift, and the copy over there is not the one that runs everywhere.
     */
    instructions:
      'Personal fitness tracker for a single user. When they describe training, food or ' +
      'bodyweight, parse it and call log_entry with both the raw text and the structured ' +
      'data. Everything from one message lands under one journal entry so it can be undone ' +
      'as a unit.\n\n' +

      'DATES are when things HAPPENED, not when they were typed: "yesterday I squatted" is a ' +
      'workout dated yesterday. Resolve a named weekday to an actual date; ask if it is ' +
      'genuinely ambiguous.\n\n' +

      'CATALOGS. foods and exercises hold facts that stay true every time; meals, workouts ' +
      'and bodyweight record what happened and POINT at a catalog row. A log row never ' +
      'carries macros or muscles of its own, which is why correcting a catalog entry fixes ' +
      'every entry ever logged with it — and why you search before creating anything.\n\n' +

      'NAMES are stored character-for-character and displayed exactly as given, so write them ' +
      'in Title Case the way a menu or a program sheet does: "Grilled Chicken Breast", ' +
      '"Barbell Back Squat". Short joining words stay lower case unless they lead — "Oatmeal ' +
      'with Berries". Keep acronyms as they are: "RDL", "EZ Bar Curl". A dropped capital ' +
      'stays dropped. Aliases are the opposite: always lower case, since they are match keys ' +
      'and are never shown.\n\n' +

      'MEALS: one row per DISH — not per meal, and not per ingredient. A dinner of cod, green ' +
      'beans, rice and salad is four rows sharing an entry_date and meal_type. But a protein ' +
      'shake of milk, banana and two scoops of powder is ONE row: those are ingredients, ' +
      'listed so you can compute macros, not separate things eaten. The test is whether an ' +
      'item could have been swapped out without changing the rest of the meal. Set meal_type ' +
      'on every meal row.\n\n' +

      'EVERY food goes in the catalog — sides and plain items too, not just composed dishes. ' +
      'Macros live ONLY on foods; a meal is a pointer plus how many units were eaten. ALWAYS ' +
      'call search_foods first: if it is already catalogued, log with its food_id and reuse ' +
      'its macros rather than estimating again. If nothing matches, put the food inline on ' +
      'the meal with PER-UNIT macros and a unit_label ("filet", "cup", "scoop") — the server ' +
      'catalogues it and links the meal in the same call. Name the food, not the serving: ' +
      '"Roasted Broccoli", never "side of broccoli, about a cup". Quantity goes in servings. ' +
      'Give short aliases so it is easy to find later.\n\n' +

      'CONFIDENCE lives on the food, not the meal: high for a label or exact numbers, medium ' +
      'for macros worked out from a real ingredient list, low for a guess from a description. ' +
      'Do not inflate it — an honest low is what gets the number fixed later.\n\n' +

      'WORKOUTS work the same way: call search_exercises first and log against its id; supply ' +
      'an exercise inline only when nothing matches.\n\n' +

      'When cataloguing a movement, pattern is the field that matters most — push, pull, ' +
      'legs, core, cardio, or other for sport. It is what the calendar groups days by, and it ' +
      'is a property of the MOVEMENT, not of the muscles: a bench press is push even though ' +
      'the triceps work hard, and a curl is pull even though it is also an arm. Anything ' +
      'pressing away from the body is push, anything pulling toward it is pull, squats and ' +
      'hinges and lunges are legs.\n\n' +

      'ALWAYS give a new exercise at least one primary muscle, using names from list_muscles ' +
      '— anything else is rejected. This is not optional in practice: an exercise catalogued ' +
      'without it is invisible to every muscle-coverage question from then on, and nothing ' +
      'ever flags it as missing. Primary means what the movement is FOR, not merely what is ' +
      'active: on a cardio exercise that is "cardiovascular" with the legs secondary, because ' +
      'marking the legs primary makes every run register as leg training. A push-up is chest ' +
      'and triceps, not nothing.\n\n' +

      'SETS: give ONE entry per set actually performed. "3x5 at 225" is three identical ' +
      'entries; "225x5, 245x3, 265x1" is three different ones — flattening a ramp to one ' +
      'number destroys both the PR and the volume. Cardio is a single entry carrying ' +
      'distance_mi and/or duration_sec, and duration is WHOLE SECONDS — a 40 minute run is ' +
      '2400, never 40. Always record distance when one is mentioned.\n\n' +

      'RE-LOGGING an exercise that already has sets on that date is governed by set_mode, and ' +
      'it is the one field here that can destroy data. The default, "replace", throws away ' +
      'what is stored and keeps what you send — so a correction must carry the FULL list, not ' +
      'only the set that changed. Send "append" whenever the new sets are additional work ' +
      'rather than a restatement: a second session or second walk the same day, or an ' +
      'afterthought like "I forgot, I also did two more sets". Decide from what the user ' +
      'actually said; when it is genuinely unclear whether they are correcting or adding, ask ' +
      'rather than guessing, because a wrong "replace" leaves no trace outside the journal ' +
      'text. The tool reports how many sets a replace destroyed — if that count is a surprise, ' +
      'say so to the user immediately.\n\n' +

      'RPE is optional and usually absent. Record it only when the user actually says how ' +
      'hard something felt. NEVER estimate it — it is a report of how the lifter felt, so it ' +
      'cannot be inferred from the weight or the rep count, and an invented 8 is ' +
      'indistinguishable from a real one once stored. No RPE is the normal case, not a gap to ' +
      'fill.\n\n' +

      'BODYWEIGHT is one weigh-in per day; logging again replaces it. Record what they say ' +
      'without rounding.\n\n' +

      'CORRECTING: save_food fixes a food\'s macros and changes every meal ever logged with ' +
      'it. save_exercise fixes an exercise, and is the ONLY way to rename one — logging a ' +
      'corrected spelling inline creates a second exercise and splits the history instead of ' +
      'repairing it. Say when a correction will move past days\' totals, because it will.\n\n' +

      'DELETING: delete_entries removes logged rows. JOURNAL TEXT IS NEVER DELETED and there ' +
      'is no tool that deletes it — the journal is the record of what was said, and it was ' +
      'said; only the rows parsed out of it can be wrong. Do not offer to delete a journal. ' +
      'Remove a whole message\'s output with journal_id, or single rows with the ids from ' +
      'get_recent_history when only part of a message was wrong — "delete the basketball" ' +
      'when that message also logged deadlifts is one workout id, not the journal. ALWAYS ' +
      'call first with confirm: false, show the user exactly what would be removed, and wait ' +
      'for them to agree. Never pass confirm: true on the first call, however certain they ' +
      'sound. If the preview holds anything they did not ask to remove, say so and stop.\n\n' +

      'ANSWERING QUESTIONS: pull the real data before commenting on it. get_pattern_recency ' +
      'for what is overdue, get_pattern_volume for balance, get_exercise_history for where a ' +
      'lift is heading, get_prs for bests, get_weekly_summary for trends. Never answer from ' +
      'memory of the conversation.',
  },
);
