/**
 * The three macros, their tones and their energy density, in one place.
 *
 * The same reasoning as `patterns.ts`: every screen that shows macros imports this, so protein
 * cannot be amber on Now and grey in a chart legend. That had already happened — Now drew
 * protein in `--signal` and fat in `--signal-low`, the nutrition chart drew CALORIES in
 * `--signal-low` and protein in `--ink-dim`, and the food list drew all three in one colour and
 * relied on the letters. Three screens, three answers, and one of them said fat and calories
 * were the same thing.
 *
 * This is a lightness ramp rather than a palette, and deliberately not amber — see the token
 * block in globals.css for why. Calories own amber, and they are not a fourth entry here:
 * calories are what these three are converted into, which is what `kcalPerGram` is for.
 *
 * Order is fixed and matches how food is spoken about: protein, carbs, fat.
 */
export const MACROS = [
  { key: 'protein', label: 'Protein', short: 'P', color: 'var(--macro-protein)', kcalPerGram: 4 },
  { key: 'carbs', label: 'Carbs', short: 'C', color: 'var(--macro-carbs)', kcalPerGram: 4 },
  { key: 'fat', label: 'Fat', short: 'F', color: 'var(--macro-fat)', kcalPerGram: 9 },
] as const;

export type MacroKey = (typeof MACROS)[number]['key'];

const BY_KEY = new Map(MACROS.map((m) => [m.key, m]));

export function macroColor(key: MacroKey): string {
  return BY_KEY.get(key)!.color;
}

/**
 * Grams to calories, per macro.
 *
 * Macro grams are not comparable by weight — a gram of fat carries more than twice the energy
 * of a gram of protein — so a split bar drawn from grams is drawn to the wrong proportions.
 * This is the conversion that makes the widths mean something, kept beside the colours because
 * the two are always used together.
 */
export function macroCalories(key: MacroKey, grams: number): number {
  return grams * BY_KEY.get(key)!.kcalPerGram;
}
