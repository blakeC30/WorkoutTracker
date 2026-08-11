import { createMcpHandler } from 'mcp-handler';
import {
  getJournalInput,
  getRecentHistoryInput,
  listRecipesInput,
  logEntryInput,
  saveRecipeInput,
  undoEntryInput,
} from './schemas';
import {
  deleteJournal,
  describeJournal,
  getJournal,
  getRecentHistory,
  listRecipes,
  logEntry,
  saveRecipe,
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
          lines.push(`  ${w.updated ? 'Updated' : 'Logged'} ${w.exercise} on ${w.entry_date}`);
        }
        if (result.bodyweight) {
          lines.push(
            `  Bodyweight ${result.bodyweight.weight_lbs} lbs on ${result.bodyweight.entry_date}`,
          );
        }
        for (const m of result.meals) {
          lines.push(`  Meal "${m.description}" on ${m.entry_date}`);
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
      'undo_entry',
      {
        title: 'Delete a journal entry and everything from it',
        description:
          'Delete a journal entry and every workout, bodyweight and meal row parsed from it. ' +
          'ALWAYS call first with confirm: false, show the user exactly what would be deleted, ' +
          'and wait for them to say yes. Only then call again with confirm: true. Never pass ' +
          'confirm: true on the first call, even if the user sounds certain.',
        inputSchema: undoEntryInput,
      },
      async ({ journal_id, confirm }) => {
        const found = await describeJournal(journal_id);
        if (!found) {
          return text(`No journal entry #${journal_id}. Nothing was deleted.`);
        }

        const lines = [
          `Journal #${journal_id}, written ${found.journal.created_at}:`,
          `  "${found.journal.raw_text}"`,
        ];
        for (const w of found.workouts) lines.push(`  workout: ${w.exercise} on ${w.entry_date}`);
        for (const b of found.bodyweight) lines.push(`  bodyweight: ${b.weight_lbs} lbs on ${b.entry_date}`);
        for (const m of found.meals) lines.push(`  meal: ${m.description} on ${m.entry_date}`);

        if (!confirm) {
          return text(
            `This would permanently delete:\n\n${lines.join('\n')}\n\n` +
              `Nothing has been deleted yet. Ask the user to confirm, then call undo_entry ` +
              `again with confirm: true.`,
          );
        }

        await deleteJournal(journal_id);
        return text(`Deleted:\n\n${lines.join('\n')}`);
      },
    );
    server.registerTool(
      'save_recipe',
      {
        title: 'Save or update a recipe',
        description:
          'Store a recipe so its macros never have to be estimated again. Macros are PER ' +
          'SERVING, not per batch. Saving a name that already exists updates it. Meals ' +
          'already logged from this recipe keep the macros they were logged with — ' +
          'refining a recipe changes what gets logged next, not what was already eaten.',
        inputSchema: saveRecipeInput,
      },
      async (input) => {
        const r = await saveRecipe(input);
        return text(
          `${r.created ? 'Saved' : 'Updated'} recipe #${r.id} "${r.name}". ` +
            `Log meals from it with recipe_id ${r.id} and the number of servings eaten.`,
        );
      },
    );

    server.registerTool(
      'list_recipes',
      {
        title: 'List saved recipes',
        description:
          'Look up saved recipes and their per-serving macros. Check here BEFORE estimating ' +
          'macros for a dish — if it is already saved, use its numbers and recipe_id rather ' +
          'than guessing again.',
        inputSchema: listRecipesInput,
      },
      async ({ search }) => json(await listRecipes(search)),
    );
  },
  {
    serverInfo: { name: 'workout-tracker', version: '0.2.0' },
    instructions:
      'Personal fitness tracker for a single user. When they describe training, food or ' +
      'bodyweight, parse it and call log_entry with both the raw text and the structured ' +
      'data.\n\n' +
      'Dates are when things HAPPENED: "yesterday I squatted" is a workout dated yesterday, ' +
      'not today.\n\n' +
      'Log one meal row per DISH — not per meal, and not per ingredient. A dinner of cod, ' +
      'green beans, rice and salad is four rows sharing an entry_date and meal_type. But a ' +
      'protein shake of milk, banana and two scoops of powder is ONE row: those are ' +
      'ingredients, listed so you can compute macros, not separate things eaten. The test ' +
      'is whether an item could have been swapped out without changing the rest of the ' +
      'meal. Set meal_type on every meal row.\n\n' +
      'Before estimating macros for a dish, call list_recipes. If it is saved, use its ' +
      'macros and recipe_id instead of guessing.\n\n' +
      'If it is not saved and you work out per-serving macros for it, call save_recipe and ' +
      'then log the meal with the returned recipe_id and servings. Do not ask first — ' +
      'deriving a recipe and not saving it discards the only expensive part of the work, ' +
      'and the next meal from that dish starts from scratch.\n\n' +
      'For cardio, always record distance_mi when a distance is mentioned.',
  },
);
