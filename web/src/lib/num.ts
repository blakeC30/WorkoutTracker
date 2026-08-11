/**
 * Numeric coercion, split out from backend.ts so Client Components can use it.
 *
 * backend.ts starts with `import 'server-only'`, which makes reaching it from the browser a
 * build error — correct for the module that holds the API secret, but it also locked away the
 * one helper every screen needs. These functions touch no secrets and belong on both sides.
 *
 * Postgres `numeric` arrives over the wire as a STRING: `sum()`, `avg()` and `round()` all
 * return numeric, so `volume_lbs` is "83265" and not 83265. Columns cast `::int` come back as
 * real numbers. Rather than remember which is which at every call site, every numeric field is
 * typed `Num` and read through `n()`.
 */

// `undefined` is included because a calendar square looks up a day that may not be in the
// response at all — an absent day and a null column both mean "no reading", and forcing the
// call site to distinguish them would only produce `?? null` noise.
export type Num = string | number | null | undefined;

export function n(value: Num): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Same, for the many places where "no rows yet" should read as zero rather than blank. */
export function n0(value: Num): number {
  return n(value) ?? 0;
}
