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
  rpe: z.number().min(1).max(10).optional().describe('Rate of perceived exertion, 1-10.'),
  notes: z.string().optional(),
});

export const bodyweightInput = z.object({
  entry_date: entryDate,
  weight_lbs: z.number().positive(),
  notes: z.string().optional(),
});

export const mealInput = z.object({
  entry_date: entryDate,
  description: z.string().min(1),
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
