/**
 * The movement patterns and their colours, in one place.
 *
 * Every screen that shows a pattern imports this, so a colour can never mean push on the
 * calendar and pull on the exercises list. The order is fixed and load-bearing: it is the order of
 * the slots in a calendar square, and those slots are readable at 6px only because position
 * never changes.
 *
 * Colour here is redundant with position and label, never a replacement for either.
 */
export const PATTERNS = [
  { key: 'push', label: 'Push', color: 'var(--push)' },
  { key: 'pull', label: 'Pull', color: 'var(--pull)' },
  { key: 'legs', label: 'Legs', color: 'var(--legs)' },
  { key: 'core', label: 'Core', color: 'var(--core)' },
  { key: 'cardio', label: 'Cardio', color: 'var(--cardio)' },
] as const;

/**
 * The catch-all: sports, mobility, anything that doesn't press, pull, squat, brace or condition.
 *
 * Neutral ink rather than a sixth hue, and no calendar slot. The palette encodes the five
 * patterns a session is planned around; this bucket is "none of those", and giving it a colour
 * would imply it belongs to the same series.
 *
 * Two labels because the contexts differ. `label` is used where a line of text has room and the
 * word "sport" is worth saying — an occasional match should read as something you did, not as a
 * leftover category. `short` is for the 54px columns, where nothing longer than six characters
 * fits at this type size.
 */
export const OTHER_PATTERN = {
  key: 'other',
  label: 'Sport & other',
  short: 'Other',
  color: 'var(--ink-dim)',
} as const;

/**
 * Everything that can appear as a ROW in a list, as opposed to a slot in a calendar square.
 *
 * The distinction is the point: the square has five fixed positions and its legibility depends
 * on that staying true, but a list can grow. Sports used to be dropped from last-trained, the
 * coverage matrix and the volume section that used to sit on Now, because those all iterated the
 * five — 75 minutes of basketball reported as nothing at all.
 */
export const PATTERN_ROWS = [...PATTERNS, OTHER_PATTERN] as const;

export type PatternKey = (typeof PATTERNS)[number]['key'];

const BY_KEY = new Map(PATTERN_ROWS.map((p) => [p.key, p]));

/**
 * An exercise with no pattern, or one stored as 'other', falls back to plain ink rather than
 * borrowing a colour. Guessing which bucket it belongs to would put a wrong colour on a real
 * exercise, and the whole point of the palette is that a colour means one thing.
 */
export function patternColor(key: string | null | undefined): string {
  return BY_KEY.get((key ?? '') as PatternKey)?.color ?? OTHER_PATTERN.color;
}

/** The compact form. Used on row chips and in narrow label columns, where six characters fit. */
export function patternLabel(key: string | null | undefined): string {
  const found = BY_KEY.get((key ?? '') as PatternKey);
  if (!found) return OTHER_PATTERN.short;
  return 'short' in found ? found.short : found.label;
}
