/**
 * The muscle regions, in the order they are shown.
 *
 * The order is the decision this file exists to record. Alphabetical — which is what the
 * database returns — puts arms first and legs fifth, and legs is the row most likely to be the
 * problem. This runs roughly top of the body down, so a column of them reads as a body rather
 * than as a word list, and "full body" sits last because cardiovascular is not a muscle anyone
 * plans a session around.
 *
 * **No colours here, deliberately.** Movement pattern is the one dimension this app colours,
 * and regions are a second taxonomy sitting one section away from it on the same screen. Giving
 * them hues would be the fastest way to make the pattern palette stop meaning anything — see
 * the categorical palette rules in DESIGN.md. Coverage is drawn in ink, and what varies is how
 * lit a mark is, not what colour.
 *
 * Regions come from the `muscles` table, so this list has to match it. A region in the database
 * and missing here would silently drop its muscles from the screen, which is the one failure
 * this feature exists to prevent — so `groupByRegion` returns unknown regions rather than
 * discarding them.
 */
export const REGIONS = [
  { key: 'chest', label: 'Chest' },
  { key: 'back', label: 'Back' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'arms', label: 'Arms' },
  { key: 'core', label: 'Core' },
  { key: 'legs', label: 'Legs' },
  { key: 'full body', label: 'Full body' },
] as const;

/**
 * Regions the Coverage section does not ask about.
 *
 * `full body` holds exactly one entry, `cardiovascular`, and it is not a muscle anyone neglects.
 * The question Coverage asks — what is going untrained, and what is only ever assisting — does
 * not apply to it: it is primary on every run and walk and secondary on nothing, so its row was
 * a permanent `1/1` that moved only when cardio stopped entirely. Whether cardio is happening is
 * already answered one section above, by the pattern strip, in days rather than in muscles.
 *
 * Kept in REGIONS rather than deleted from it, because REGIONS mirrors the `muscles` table and
 * is where display order is decided. This is a separate statement — that one region is not part
 * of THIS question — and keeping the two apart means an exclusion cannot be mistaken for the
 * taxonomy having a hole in it.
 */
export const REGIONS_OUTSIDE_COVERAGE: readonly string[] = ['full body'];

/** Drop the regions Coverage does not ask about. Applied before counting, so the header total
    and the rows below it can never disagree about how many muscles are in scope. */
export function forCoverage<T extends { region: string }>(rows: T[]): T[] {
  return rows.filter((row) => !REGIONS_OUTSIDE_COVERAGE.includes(row.region));
}

const ORDER = new Map(REGIONS.map((r, i) => [r.key as string, i]));

/** Title Case for a region the list above does not know about, so it can still be shown. */
function fallbackLabel(key: string): string {
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Group rows by region, in REGIONS order, with anything unrecognised appended rather than
 * dropped. Regions with no muscles at all are omitted — that is a taxonomy with an empty
 * bucket, not a training gap, and the gaps are what this screen is for.
 */
export function groupByRegion<T extends { region: string }>(
  rows: T[],
): { key: string; label: string; rows: T[] }[] {
  const byRegion = new Map<string, T[]>();
  for (const row of rows) {
    const list = byRegion.get(row.region);
    if (list) list.push(row);
    else byRegion.set(row.region, [row]);
  }

  return [...byRegion.entries()]
    .map(([key, group]) => ({
      key,
      label: REGIONS.find((r) => r.key === key)?.label ?? fallbackLabel(key),
      rows: group,
    }))
    .sort((a, b) => (ORDER.get(a.key) ?? REGIONS.length) - (ORDER.get(b.key) ?? REGIONS.length));
}
