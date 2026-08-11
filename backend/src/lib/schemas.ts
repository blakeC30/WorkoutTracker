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

/**
 * Exercise names are normalized on the way in: lowercased and trimmed.
 *
 * Without this, "Bench Press" and "bench press" become two different exercises, which
 * breaks both the one-row-per-exercise-per-day constraint and PR tracking. Doing it here
 * — in one place, at the edge — is simpler than normalizing at every query.
 */
export const exerciseName = z
  .string()
  .min(1)
  .transform((s) => s.trim().toLowerCase())
  .describe('Exercise name, e.g. "back squat", "bench press", "running".');

export const workoutInput = z.object({
  entry_date: entryDate,
  exercise: exerciseName,
  category: z
    .string()
    .optional()
    .describe('Broad grouping, e.g. "legs", "push", "pull", "cardio".'),
  sets: z.number().int().positive().optional(),
  reps: z.number().int().positive().optional().describe('Reps per set, not total reps.'),
  weight_lbs: z.number().nonnegative().optional().describe('Omit for bodyweight work.'),
  duration_min: z.number().nonnegative().optional().describe('For cardio or timed work.'),
  distance_mi: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      'Distance in miles, for running, walking, rowing, cycling. Always record this when ' +
        'the user mentions a distance — it is the main measure of cardio volume.',
    ),
  rpe: z.number().min(1).max(10).optional().describe('Rate of perceived exertion, 1-10.'),
  notes: z.string().optional(),
});

export const bodyweightInput = z.object({
  entry_date: entryDate,
  weight_lbs: z.number().positive(),
  notes: z.string().optional(),
});

/**
 * A recipe supplied inline with a meal.
 *
 * This exists so logging a dish from a recipe is ONE tool call. Relying on the model to
 * follow up with a separate save_recipe call did not work in practice — it derived correct
 * per-serving macros and then dropped them, twice, with the instruction stated explicitly
 * in both the project prompt and the server's own instructions. The same dish came back
 * 60% apart on consecutive days as a result.
 *
 * Filling in a field of a payload you are already sending is far more reliable than
 * remembering a second action, so the server does the saving.
 */
export const inlineRecipe = z.object({
  name: z
    .string()
    .min(1)
    .describe('Short identifying name, e.g. "miso black cod". Reused to match existing recipes.'),
  source_url: z.string().optional().describe('Where the recipe came from, if anywhere.'),
  yields_servings: z
    .number()
    .positive()
    .optional()
    .describe('How many servings the whole recipe makes — not how many were eaten.'),
  calories: z.number().int().nonnegative().optional().describe('PER SERVING, not per batch.'),
  protein_g: z.number().int().nonnegative().optional().describe('Per serving.'),
  carbs_g: z.number().int().nonnegative().optional().describe('Per serving.'),
  fat_g: z.number().int().nonnegative().optional().describe('Per serving.'),
  notes: z.string().optional(),
});

export const mealInput = z.object({
  entry_date: entryDate,
  meal_type: z
    .enum(['breakfast', 'lunch', 'dinner', 'snack', 'dessert'])
    .optional()
    .describe('Which meal this belongs to. Set it on every meal row.'),
  description: z
    .string()
    .min(1)
    .describe(
      'ONE component, not a whole meal. A dinner of cod, green beans, rice and salad is ' +
        'four separate meal rows sharing an entry_date and meal_type — never one lumped row.',
    ),
  recipe_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('If this came from an ALREADY-saved recipe, its id from list_recipes.'),
  recipe: inlineRecipe
    .optional()
    .describe(
      'If this dish comes from a recipe that is NOT already saved, put it here with ' +
        'per-serving macros. The server saves it and links this meal automatically — you do ' +
        'not need a separate save_recipe call. Set servings to how many were eaten and the ' +
        'server computes this row\'s macros from the per-serving numbers.',
    ),
  servings: z
    .number()
    .positive()
    .optional()
    .describe('Servings eaten, when logging from a recipe. Recipe macros are per serving.'),
  calories: z.number().int().nonnegative().optional(),
  protein_g: z.number().int().nonnegative().optional(),
  carbs_g: z.number().int().nonnegative().optional(),
  fat_g: z.number().int().nonnegative().optional(),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .optional()
    .describe(
      'How confident you are in the macro numbers. "high" if the user gave exact figures ' +
        'or it is a packaged food; "low" if you estimated from a vague description like ' +
        '"a big bowl of pasta". Low-confidence rows surface in the dashboard review queue.',
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

export const undoEntryInput = z.object({
  journal_id: z.number().int().positive().describe('The journal id to delete.'),
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

export const saveRecipeInput = z.object({
  name: z.string().min(1).describe('Short identifying name, e.g. "miso black cod".'),
  source_url: z.string().optional().describe('Where the recipe came from, if anywhere.'),
  servings: z.number().positive().optional().describe('How many servings the recipe yields.'),
  calories: z.number().int().nonnegative().optional().describe('PER SERVING, not per batch.'),
  protein_g: z.number().int().nonnegative().optional().describe('Per serving.'),
  carbs_g: z.number().int().nonnegative().optional().describe('Per serving.'),
  fat_g: z.number().int().nonnegative().optional().describe('Per serving.'),
  notes: z.string().optional(),
});

export const listRecipesInput = z.object({
  search: z
    .string()
    .optional()
    .describe('Optional substring to filter by name. Omit to list everything.'),
});
