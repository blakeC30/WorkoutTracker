import 'server-only';

/**
 * The only thing in web/ that knows the API secret.
 *
 * `import 'server-only'` is not a comment — it makes the build FAIL if this module is ever
 * reached from a Client Component, so the rule "the browser never sees the secret" is enforced
 * by the compiler rather than by remembering. Every screen fetches here in a Server Component
 * and passes plain JSON down as props.
 */

const BACKEND_URL = process.env.BACKEND_URL;
const API_SECRET = process.env.API_SECRET;

/**
 * Either the rows, or the reason there aren't any. Deliberately not a thrown error: a screen
 * shows three or four independent sections, and one endpoint being down should cost you that
 * section, not the whole page. Callers render <Fault> for the error arm.
 */
export type Result<T> = { ok: true; rows: T[] } | { ok: false; error: string };

async function query<T>(path: string, params: Record<string, string | number> = {}): Promise<Result<T>> {
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

/**
 * Postgres `numeric` arrives over the wire as a STRING — `sum()`, `avg()` and `round()` all
 * return numeric, so `volume_lbs` is "83265" and not 83265. Columns cast `::int` come back as
 * real numbers. Rather than remember which is which at every call site, every numeric field is
 * typed `Num` and read through `n()`.
 */
export type Num = string | number | null;

export function n(value: Num): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Same, for the many places where "no rows yet" should read as zero rather than blank. */
export function n0(value: Num): number {
  return n(value) ?? 0;
}

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

export type WeekRow = {
  week_starting: string;
  training_days: number;
  exercises_performed: number;
  total_sets: number;
  volume_lbs: Num;
  cardio_miles: Num;
  cardio_minutes: Num;
  avg_rpe: Num;
  avg_calories: Num;
  avg_protein_g: Num;
  avg_weight_lbs: Num;
  weigh_ins: number;
};

export type PrRow = {
  exercise: string;
  category: string | null;
  record_type: 'weighted' | 'endurance';
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
};

export type ReviewRow = {
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

export const getBodyweight = (days = 90) => query<BodyweightRow>('/api/stats/bodyweight', { days });
export const getMuscles = (days = 28) => query<MuscleRow>('/api/stats/muscles', { days });
export const getNutrition = (days = 30) => query<NutritionRow>('/api/stats/nutrition', { days });
export const getWeeks = (weeks = 8) => query<WeekRow>('/api/stats/weekly', { weeks });
export const getPrs = (limit = 50) => query<PrRow>('/api/stats/prs', { limit });
export const getReview = (limit = 25) => query<ReviewRow>('/api/stats/review', { limit });
