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

export type PatternKey = (typeof PATTERNS)[number]['key'];

const BY_KEY = new Map(PATTERNS.map((p) => [p.key, p]));

/**
 * An exercise with no pattern, or one stored as 'other', falls back to plain ink rather than
 * borrowing a colour. Guessing which bucket it belongs to would put a wrong colour on a real
 * exercise, and the whole point of the palette is that a colour means one thing.
 */
export function patternColor(key: string | null | undefined): string {
  return BY_KEY.get((key ?? '') as PatternKey)?.color ?? 'var(--ink-dim)';
}

export function patternLabel(key: string | null | undefined): string {
  return BY_KEY.get((key ?? '') as PatternKey)?.label ?? 'Other';
}
