import { createMcpHandler } from 'mcp-handler';
import {
  getJournalInput,
  getRecentHistoryInput,
  searchFoodsInput,
  logEntryInput,
  saveFoodInput,
  undoEntryInput,
} from './schemas';
import {
  deleteJournal,
  describeJournal,
  getJournal,
  getRecentHistory,
  searchFoods,
  logEntry,
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
          lines.push(`  ${w.updated ? 'Updated' : 'Logged'} ${w.exercise} on ${w.entry_date}`);
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
  },
  {
    serverInfo: { name: 'workout-tracker', version: '0.4.0' },
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
      'EVERY food goes in the catalog — sides and plain items too, not just composed ' +
      'dishes. Macros live ONLY on foods; a meal is a pointer plus how many units were ' +
      'eaten. ALWAYS call search_foods first: if it is already catalogued, log with its ' +
      'food_id and reuse its macros rather than estimating again. If nothing matches, put ' +
      'the food inline on the meal with PER-UNIT macros and a unit_label ("filet", "cup", ' +
      '"scoop") — the server catalogues it and links the meal in the same call. Give short ' +
      'aliases so it is easy to find later. Correcting a food fixes every meal ever logged ' +
      'with it.\n\n' +
      'For cardio, always record distance_mi when a distance is mentioned.',
  },
);
