import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySessionToken } from './session';

/**
 * The only thing in web/ that knows the API secret.
 *
 * `import 'server-only'` is not a comment — it makes the build FAIL if this module is ever
 * reached from a Client Component, so the rule "the browser never sees the secret" is enforced
 * by the compiler rather than by remembering. Every screen fetches here in a Server Component
 * and passes plain JSON down as props.
 *
 * Being the only module that can reach the backend also makes it the right place to enforce
 * the session. `proxy.ts` redirects unauthenticated visitors, but a path regex is a list of
 * things someone remembered, and this is a chokepoint: a route the matcher misses still
 * cannot read a single row, because reading one means calling through here.
 */

const BACKEND_URL = process.env.BACKEND_URL;
const API_SECRET = process.env.API_SECRET;

/**
 * Throws (as a redirect) unless the caller holds a valid session.
 *
 * `redirect` works by throwing, so this must be called BEFORE any try/catch — inside one, the
 * catch swallows the redirect and turns a security check into an error message.
 */
async function requireSession(): Promise<void> {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE)?.value)) redirect('/login');
}

/**
 * Either the rows, or the reason there aren't any. Deliberately not a thrown error: a screen
 * shows three or four independent sections, and one endpoint being down should cost you that
 * section, not the whole page. Callers render <Fault> for the error arm.
 */
export type Result<T> = { ok: true; rows: T[] } | { ok: false; error: string };

/** Same contract for endpoints that return one object rather than a list of rows. */
export type One<T> = { ok: true; row: T } | { ok: false; error: string };

async function query<T>(path: string, params: Record<string, string | number> = {}): Promise<Result<T>> {
  await requireSession();

  if (!BACKEND_URL || !API_SECRET) {
    return { ok: false, error: 'BACKEND_URL and API_SECRET are not set in web/.env.local' };
  }

  const url = new URL(path, BACKEND_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${API_SECRET}` },
      // The log changes whenever a workout is logged from the phone, which is the whole point.
      // A cached dashboard would show yesterday's numbers with no way to tell.
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 404) {
      // The backend answers 404, not 401, to a bad secret — a 401 makes MCP clients start an
      // OAuth handshake. So a 404 here means either a wrong secret or a wrong URL, and it is
      // worth saying both rather than reporting "not found".
      return { ok: false, error: 'Backend rejected the request — check API_SECRET matches, and BACKEND_URL is right' };
    }
    if (!response.ok) return { ok: false, error: `Backend returned ${response.status}` };

    const body = (await response.json()) as { ok: boolean; data?: T[]; error?: string };
    if (!body.ok) return { ok: false, error: body.error ?? 'Query failed' };
    return { ok: true, rows: body.data ?? [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed';
    return { ok: false, error: message.includes('timed out') ? 'Backend timed out' : message };
  }
}

/** The object-returning counterpart to `query`. Shares its error handling by delegating. */
async function queryOne<T>(path: string, params: Record<string, string | number> = {}): Promise<One<T>> {
  const result = await query<T>(path, params);
  if (!result.ok) return result;
  // `query` reads `data ?? []`; an object endpoint puts its object in that same slot, so the
  // array wrapper here is an artefact of sharing the transport, not of the response shape.
  const row = result.rows as unknown as T;
  return row ? { ok: true, row } : { ok: false, error: 'Empty response' };
}

// Re-exported so every screen keeps importing coercion from the same place it imports its
// row types, even though the implementation now lives in a module the browser can also reach.
// The separate `import type` is not redundant: a re-export forwards the name to consumers but
// does not bring it into this file's own scope, and every row type below is written in terms
// of it.
import type { Num } from './num';
export { n, n0 } from './num';
export type { Num };

// --- Row shapes -------------------------------------------------------------------------
//
// Hand-written duplicates of what backend/src/lib/stats.ts returns. Duplicated on purpose:
// the two apps deploy separately and sharing types would mean monorepo tooling for four
// interfaces. If a query changes shape, this file changes with it.

export type BodyweightRow = {
  date: string;
  weight_lbs: Num;
  rolling_7d: Num;
  days_in_window: number;
};

export type MuscleRow = {
  region: string;
  primary_volume_lbs: Num;
  secondary_volume_lbs: Num;
  primary_sessions: number;
  secondary_sessions: number;
};

export type NutritionRow = {
  date: string;
  calories: Num;
  protein_g: Num;
  carbs_g: Num;
  fat_g: Num;
  items: number;
};

export type PrRow = {
  exercise: string;
  category: string | null;
  pattern: string | null;
  /**
   * Three kinds of record, because three kinds of set exist. `bodyweight` covers push-ups,
   * sit-ups and pull-ups — reps at no load, which match neither a tonnage PR nor a distance.
   */
  record_type: 'weighted' | 'bodyweight' | 'endurance' | 'other';
  /** Most reps in a single unloaded set. The calisthenic equivalent of a heaviest single. */
  best_reps: number | null;
  best_reps_on: string | null;
  total_bodyweight_reps: number | null;
  heaviest_lbs: Num;
  heaviest_reps: number | null;
  heaviest_on: string | null;
  best_e1rm_lbs: Num;
  best_e1rm_weight: Num;
  best_e1rm_reps: number | null;
  best_e1rm_on: string | null;
  best_distance_mi: Num;
  best_duration_min: Num;
  best_pace_min_per_mi: Num;
  total_sets: number;
  last_performed: string;
  /**
   * The last ten sessions, oldest first, in whatever unit this exercise is measured in.
   *
   * Drawn as a sparkline per row so each exercise is shown against ITS OWN history. The list
   * used to scale every bar against the heaviest exercise on it, which put a curl at 11% of a
   * leg press — a comparison nobody can act on, since nobody curls what they leg press.
   */
  trend: number[] | null;
};

/** A food you have eaten, with what it contains and how often. */
export type FoodRow = {
  id: number;
  name: string;
  unit_label: string | null;
  confidence: 'low' | 'medium' | 'high' | null;
  calories: Num;
  protein_g: Num;
  carbs_g: Num;
  fat_g: Num;
  times_eaten: number;
  total_calories: Num;
  last_eaten: string;
};

/** One row per day that has anything on it. Days with nothing recorded are simply absent. */
export type CalendarRow = {
  date: string;
  exercises: number;
  sets: number;
  volume_lbs: Num;
  cardio_mi: Num;
  cardio_min: Num;
  /** Movement patterns trained that day — what the squares and the matrix are drawn from. */
  patterns: string[];
  items: number;
  calories: Num;
  protein_g: Num;
  /** Which meals were logged. Absence here is a hole in logging, not a day without eating. */
  meal_types: string[];
  weight_lbs: Num;
};

/** How long since each movement pattern was last trained, longest gap first. */
export type RecencyRow = {
  pattern: string;
  last_date: string | null;
  days_since: number | null;
};

export const getRecency = () => query<RecencyRow>('/api/stats/recency');

/** Training days per calendar month — the only reading in the app that looks past 30 days. */
export type MonthRow = {
  month: string;
  training_days: number;
  /** Days of that month that have happened, so a running month is not read as a collapse. */
  days_elapsed: number;
};

export const getMonths = (months = 6) => query<MonthRow>('/api/stats/months', { months });

/**
 * Training by pattern. No fan-out here — pattern is one column on the exercise.
 *
 * Four independent measures, each null when never recorded. One pattern can produce several at
 * once: core covers weighted crunches (tonnage), situps (reps) and planks (time), and cardio
 * may be logged in miles, minutes, or both.
 */
export type PatternVolumeRow = {
  pattern: string;
  volume_lbs: Num;
  /** Reps performed with no external load. Weighted reps are counted in `volume_lbs` instead. */
  bodyweight_reps: Num;
  sessions: number;
  days: number;
  distance_mi: Num;
  duration_min: Num;
};

export const getVolumeByPattern = (days = 28) =>
  query<PatternVolumeRow>('/api/stats/patterns', { days });

export type ExerciseSession = {
  date: string;
  sets: number;
  total_reps: number;
  volume_lbs: Num;
  top_weight: Num;
  e1rm: Num;
  distance_mi: Num;
  duration_min: Num;
  avg_rpe: Num;
  set_detail: DaySet[];
};

export type ExerciseHistory = {
  exercise: {
    id: number;
    name: string;
    category: string | null;
    pattern: string | null;
    equipment: string | null;
    notes: string | null;
    muscles: { name: string; region: string; role: 'primary' | 'secondary' }[];
  };
  /** Oldest first, so it plots left to right. */
  sessions: ExerciseSession[];
};

export const getExercise = (name: string) => queryOne<ExerciseHistory>('/api/stats/exercise', { name });

/**
 * Correct a food's macros. The only write the dashboard makes.
 *
 * Lives here so the secret stays in the one module that already holds it. Returns a plain
 * result rather than throwing, because the caller is a form that has to render the failure.
 */
export async function updateFood(input: {
  food_id: number;
  name: string;
  calories?: number;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  confidence?: 'high' | 'medium' | 'low';
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // A write, and reachable as a Server Action — which is its own POST endpoint that a path
  // matcher does not necessarily cover. The check matters more here than on any read.
  await requireSession();

  if (!BACKEND_URL || !API_SECRET) {
    return { ok: false, error: 'BACKEND_URL and API_SECRET are not set' };
  }

  try {
    const response = await fetch(new URL('/api/foods', BACKEND_URL), {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !body?.ok) {
      return { ok: false, error: body?.error ?? `Backend returned ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Request failed' };
  }
}

export type DaySet = {
  set_number: number;
  reps: number | null;
  weight_lbs: Num;
  duration_min: Num;
  distance_mi: Num;
  rpe: Num;
  notes: string | null;
};

export type DayWorkout = {
  exercise: string;
  category: string | null;
  pattern: string | null;
  equipment: string | null;
  notes: string | null;
  sets: DaySet[];
};

/**
 * Macros here are PER UNIT, exactly as they sit on the food — `servings` multiplies them.
 * A 6 oz chicken breast arrives as calories: 47, servings: 6. Rendering `calories` on its own
 * would under-report the day by a factor of the portion size.
 */
export type DayMeal = {
  id: number;
  meal_type: string | null;
  type_order: number;
  servings: Num;
  note: string | null;
  name: string;
  unit_label: string | null;
  confidence: 'low' | 'medium' | 'high' | null;
  source_url: string | null;
  calories: Num;
  protein_g: Num;
  carbs_g: Num;
  fat_g: Num;
};

/** `logged_on` is the journal's own date and is NOT the day it describes. */
export type DayJournal = {
  id: number;
  raw_text: string;
  source: string;
  logged_at: string;
  logged_on: string;
};

export type DayDetail = {
  date: string;
  bodyweight: { weight_lbs: Num; notes: string | null } | null;
  workouts: DayWorkout[];
  meals: DayMeal[];
  journals: DayJournal[];
};

export const getCalendar = (from: string, to: string) =>
  query<CalendarRow>('/api/stats/calendar', { from, to });

export const getDay = (date: string) => queryOne<DayDetail>('/api/stats/day', { date });

export const getBodyweight = (days = 90) => query<BodyweightRow>('/api/stats/bodyweight', { days });
export const getMuscles = (days = 28) => query<MuscleRow>('/api/stats/muscles', { days });
export const getNutrition = (days = 30) => query<NutritionRow>('/api/stats/nutrition', { days });
export const getPrs = (limit = 50) => query<PrRow>('/api/stats/prs', { limit });
export const getFoods = (days = 30, limit = 60, q?: string) =>
  query<FoodRow>('/api/stats/foods', q ? { days, limit, q } : { days, limit });

/** Only the flagged ones, all-time. Used for the count on Today. */
export const getReview = (limit = 25) => query<FoodRow>('/api/stats/review', { limit });
