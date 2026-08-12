import { z } from 'zod';

/**
 * Validation for everything that comes in from an MCP tool call.
 *
 * zod 4 here, matching mcp-handler v2 -> @modelcontextprotocol/server v2, which depends on
 * zod ^4.2. The MCP server reads these schemas to generate the tool definitions Claude
 * sees, so the .describe() text is not a comment — it's the documentation Claude reads
 * when deciding what to put in each field.
 */

/** YYYY-MM-DD. Stored straight into a Postgres `date` column. */
export const entryDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .describe(
    'The date the activity actually happened, as YYYY-MM-DD. NOT the date it was logged. ' +
      'If the user says "yesterday I squatted", this is yesterday.',
  );

/*
 * There is deliberately no name-normalising transform here.
 *
 * There used to be: `exerciseName` lowercased and trimmed, with a comment claiming it stopped
 * "Bench Press" and "bench press" becoming two exercises. It was never imported anywhere, so it
 * never once ran — and it was the wrong fix regardless. Lowercasing on the way in destroys what
 * cannot be recovered: RDL becomes rdl, McDonald's becomes mcdonald's, and no amount of
 * capitalising at display time gets them back, because title-casing every word produces Rdl and
 * Mcdonald's.
 *
 * Names are stored exactly as written. Duplicates are prevented by the case-insensitive unique
 * indexes from migration 007, which is where that job belongs.
 */

/** One set. Cardio is a single set carrying distance and/or duration. */
export const setInput = z.object({
  reps: z.number().int().positive().optional(),
  weight_lbs: z.number().nonnegative().optional().describe('Omit for bodyweight work.'),
  duration_min: z.number().nonnegative().optional(),
  distance_mi: z.number().nonnegative().optional().describe('Miles. Always record for cardio.'),
  rpe: z.number().min(1).max(10).optional().describe('Effort for THIS set, 1-10.'),
  notes: z.string().optional(),
});

/**
 * An exercise supplied inline, for movements not yet in the catalog.
 *
 * Facts about the movement itself — true every time it is performed. What happened on a
 * given day belongs in `sets`, not here.
 */
export const inlineExercise = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'Canonical name for the movement, e.g. "Back Squat", "Treadmill Run". Not "3x5 back ' +
        'squat". Title Case, the way a program sheet writes it: capitalise each word, but ' +
        'leave short joining words lower case unless they lead — "Good Morning", "Farmer ' +
        'Carry", "Pull-up with Band". Keep acronyms as they are: "RDL", "EZ Bar Curl". Names ' +
        'are stored exactly as given and shown that way, so a dropped capital stays dropped.',
    ),
  aliases: z
    .array(z.string())
    .optional()
    .describe(
      'Short names the user actually says, e.g. ["squat", "bb squat"]. Lower case — these are ' +
        'match keys, never displayed.',
    ),
  category: z
    .enum(['strength', 'cardio', 'mobility', 'sport', 'other'])
    .optional(),
  pattern: z
    .enum(['push', 'pull', 'legs', 'core', 'cardio', 'other'])
    .optional()
    .describe(
      'Movement pattern, which is what the CALENDAR groups days by. This is a property of ' +
        'the movement, not of the muscles: a bench press is "push" even though triceps work ' +
        'hard, and a curl is "pull" even though it is also an arm. Anything pressing away ' +
        'from the body is push; anything pulling toward it is pull; squats, hinges and lunges ' +
        'are legs.',
    ),
  equipment: z
    .string()
    .optional()
    .describe('e.g. "barbell", "dumbbell", "machine", "bodyweight", "treadmill".'),
  primary_muscles: z
    .array(z.string())
    .optional()
    .describe(
      'ALWAYS supply at least one. Muscles this movement mainly trains, e.g. ["quads", ' +
        '"glutes"]; for cardio it is ["cardiovascular"]. Names must come from list_muscles — ' +
        'unknown ones are rejected so the catalog stays consistent. An exercise saved without ' +
        'these is invisible to every muscle-coverage question forever after, and nothing ' +
        'later notices it is missing. Optional in the schema only so a whole log entry is ' +
        'never rejected over metadata — not because leaving it out is acceptable.',
    ),
  secondary_muscles: z
    .array(z.string())
    .optional()
    .describe('Muscles that assist. Names from list_muscles.'),
  notes: z.string().optional(),
});

export const workoutInput = z.object({
  entry_date: entryDate,
  exercise_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Id from search_exercises. Use whenever a catalogued exercise matches.'),
  exercise: inlineExercise
    .optional()
    .describe(
      'For a movement not in the catalog. The server adds it and links the workout in one ' +
        'step. Search first — only supply this when nothing matches.',
    ),
  sets: z
    .array(setInput)
    .optional()
    .describe(
      'One entry PER SET, in the order performed. "3x5 at 225" is three identical entries; ' +
        '"225x5, 245x3, 265x1" is three different ones. Cardio is a single entry with ' +
        'distance_mi and/or duration_min. See set_mode for what happens to sets already ' +
        'logged for this exercise on this date.',
    ),
  set_mode: z
    .enum(['replace', 'append'])
    .default('replace')
    .describe(
      'What to do with sets ALREADY logged for this exercise on this date. "replace" — the ' +
        'default — throws them away and stores this list instead, which is what a correction ' +
        'means: send the full corrected list, not only the set that changed. Use "append" ' +
        'when this is ADDITIONAL work rather than a restatement: a second session or second ' +
        'walk the same day, or "I forgot to say I also did two more sets". Getting this wrong ' +
        'in the append direction double-counts; getting it wrong in the replace direction ' +
        'destroys the earlier sets, and only the journal text will still mention them.',
    ),
  notes: z.string().optional().describe('About the session as a whole.'),
});

export const bodyweightInput = z.object({
  entry_date: entryDate,
  weight_lbs: z.number().positive(),
  notes: z.string().optional(),
});

/**
 * A food supplied inline with a meal.
 *
 * Macros here are PER UNIT of `unit_label`, and they are the only place macros live —
 * meals store a pointer and a quantity, nothing more. Correcting a food therefore corrects
 * every meal ever logged with it, which is the point of the catalog.
 *
 * Supplying this inline means logging a new food is one tool call: the server upserts it by
 * name and links the meal in the same transaction.
 */
export const inlineFood = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'Short catalog name for the food itself, e.g. "Nobu Miso Black Cod", "Green Beans". ' +
        'Not a description of this particular serving — no "(side)", no "2 filets". Title ' +
        'Case, the way a menu writes it, with short joining words left lower case unless they ' +
        'lead — "Oatmeal with Berries", "Turkey and Swiss Sandwich". Stored and shown exactly ' +
        'as given.',
    ),
  unit_label: z
    .string()
    .optional()
    .describe(
      'What ONE unit is: "filet", "cup", "scoop", "slice", "shake". Macros below are per ' +
        'one of these. Defaults to "serving".',
    ),
  calories: z.number().int().nonnegative().optional().describe('Per unit.'),
  protein_g: z.number().int().nonnegative().optional().describe('Per unit.'),
  carbs_g: z.number().int().nonnegative().optional().describe('Per unit.'),
  fat_g: z.number().int().nonnegative().optional().describe('Per unit.'),
  aliases: z
    .array(z.string())
    .optional()
    .describe(
      'Short names to find it by later, e.g. ["black cod", "miso cod"]. Lower case — these ' +
        'are match keys, never displayed.',
    ),
  source_url: z.string().optional(),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .optional()
    .describe(
      'How well these macros are known. This lives on the food, not the meal — fix the ' +
        'food once and every meal using it is fixed.',
    ),
  notes: z.string().optional(),
});

export const mealInput = z.object({
  entry_date: entryDate,
  meal_type: z
    .enum(['breakfast', 'lunch', 'dinner', 'snack', 'dessert'])
    .optional()
    .describe('Which meal this belongs to. Set it on every meal row.'),
  food_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Id of an existing food from search_foods. Use this whenever one matches.'),
  food: inlineFood
    .optional()
    .describe(
      'For a food not yet in the catalog. The server saves it and links this meal in one ' +
        'step. Search first — only supply this when nothing matches.',
    ),
  servings: z
    .number()
    .positive()
    .default(1)
    .describe('How many units were eaten. Two filets of a per-filet food is 2.'),
  note: z
    .string()
    .optional()
    .describe(
      'Anything specific to THIS serving that is not true of the food generally — ' +
        '"extra sauce", "restaurant portion". Leave empty normally.',
    ),
});

/**
 * One message can contain a workout, a bodyweight and a meal at once — which is why this
 * is one tool with three optional sections rather than three separate tools. Everything
 * from a single message lands under one journal row.
 */
export const logEntryInput = z.object({
  raw_text: z
    .string()
    .min(1)
    .describe('The user\'s message, verbatim. Do not clean it up or rephrase it.'),
  workouts: z.array(workoutInput).optional(),
  bodyweight: bodyweightInput.optional(),
  meals: z.array(mealInput).optional(),
});

export const getRecentHistoryInput = z.object({
  days: z
    .number()
    .int()
    .positive()
    .max(365)
    .default(14)
    .describe('How many days back from today to return.'),
});

export const getJournalInput = z.object({
  start_date: entryDate.describe('First day to include, YYYY-MM-DD.'),
  end_date: entryDate.describe('Last day to include, YYYY-MM-DD. Inclusive.'),
});

/**
 * Deletion is addressed two ways because there are two real requests.
 *
 * "That whole message was wrong" wants the journal. "That one dish was wrong" wants the row.
 * A tool offering only the first makes the second impossible whenever one message logged
 * several things — which is most messages.
 */
export const deleteEntriesInput = z.object({
  journal_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Delete everything a single message produced. The journal text itself is KEPT — only ' +
        'the workouts, meals and weigh-ins parsed from it are removed.',
    ),
  workout_ids: z
    .array(z.number().int().positive())
    .optional()
    .describe(
      'Specific workouts to delete, by id from get_recent_history. A workout is one exercise ' +
        'on one day; its sets go with it.',
    ),
  meal_ids: z
    .array(z.number().int().positive())
    .optional()
    .describe('Specific meals to delete, by id from get_recent_history. One meal is one dish.'),
  bodyweight_ids: z
    .array(z.number().int().positive())
    .optional()
    .describe('Specific weigh-ins to delete, by id from get_recent_history.'),
  confirm: z
    .boolean()
    .default(false)
    .describe(
      'Leave false to preview. When false, nothing is deleted and the tool returns exactly ' +
        'what would be removed. Show that to the user, get their explicit confirmation, ' +
        'and only then call again with confirm: true.',
    ),
});

export type WorkoutInput = z.infer<typeof workoutInput>;
export type BodyweightInput = z.infer<typeof bodyweightInput>;
export type MealInput = z.infer<typeof mealInput>;
export type LogEntryInput = z.infer<typeof logEntryInput>;

/*
 * `saveRecipeInput` and `listRecipesInput` used to sit here.
 *
 * The `recipes` table was renamed to `foods` in migration 004 and `meals.recipe_id` was dropped
 * with it, so both schemas described a table that no longer exists. Neither was imported
 * anywhere, which is why they survived — dead code that still reads as an API. They are gone
 * rather than deprecated: the food catalog is the only place macros live now, and a second
 * vocabulary for it is exactly how the server instructions ended up telling the model to call a
 * `list_recipes` tool that had not existed for months.
 */

export const searchFoodsInput = z.object({
  query: z
    .string()
    .optional()
    .describe(
      'What to search for. Matches names, aliases, and close spellings — "black cod" or ' +
        '"cod" both find "nobu miso black cod". Omit to list the whole catalog.',
    ),
  limit: z.number().int().positive().max(50).default(10).optional(),
});

export const saveFoodInput = inlineFood.extend({
  food_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Existing food to update. Omit to create or match by name.'),
});

export const searchExercisesInput = z.object({
  query: z
    .string()
    .optional()
    .describe('Name, alias or approximate spelling. Omit to list the catalog.'),
  limit: z.number().int().positive().max(50).default(10).optional(),
});

export const saveExerciseInput = inlineExercise.extend({
  exercise_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'The exercise to correct, from search_exercises. Required to rename one: without an id ' +
        'a changed spelling is matched as a new movement and creates a second row, splitting ' +
        'the history. Omit only to create.',
    ),
}).extend({
  // Re-described rather than inherited. On the inline schema these are facts about a movement
  // being catalogued for the first time; here they are a correction, and replace what is
  // already stored — a difference worth stating where the model reads it.
  primary_muscles: z
    .array(z.string())
    .optional()
    .describe(
      'REPLACES the primary muscles, rather than adding to them — send the full corrected ' +
        'list. Omit to leave them untouched. Names from list_muscles.',
    ),
  secondary_muscles: z
    .array(z.string())
    .optional()
    .describe('REPLACES the secondary muscles. Omit to leave them untouched.'),
});

export const getPrsInput = z.object({
  exercise: z
    .string()
    .optional()
    .describe('Filter to exercises matching this text. Omit for all of them.'),
  limit: z.number().int().positive().max(100).default(25).optional(),
});

export const getWeeklySummaryInput = z.object({
  weeks: z.number().int().positive().max(52).default(8).optional()
    .describe('How many weeks back to summarize.'),
});

/*
 * Window schemas for the analysis tools.
 *
 * Defined here rather than inline at the registration site so every tool's input is described
 * in one file. get_volume_by_muscle used to declare its own inline and was the only one that
 * did, which is the kind of small inconsistency that makes the next person assume there are
 * two conventions.
 */
export const getVolumeByMuscleInput = z.object({
  days: z.number().int().positive().max(365).default(28).optional()
    .describe('How many days back to attribute volume over.'),
});

export const getVolumeByPatternInput = z.object({
  days: z.number().int().positive().max(365).default(28).optional()
    .describe('How many days back to total each pattern over.'),
});

export const getExerciseHistoryInput = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'Exact catalogued name of the movement, e.g. "Barbell Back Squat". Matched without ' +
        'regard to case but not fuzzily — search_exercises first to get it right.',
    ),
  limit: z.number().int().positive().max(365).default(120).optional()
    .describe('How many of the most recent sessions to return.'),
});
