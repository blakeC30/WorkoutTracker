'use server';

import { revalidatePath } from 'next/cache';
import { updateFood } from '@/lib/backend';

/**
 * The dashboard's only write.
 *
 * A Server Action rather than a route handler in `web/`: it runs on the server, so it can reach
 * the module holding the API secret, and it never becomes a public POST endpoint on this app
 * that would need its own auth. The browser posts to Next's action channel, not to the backend.
 *
 * Corrections are revalidated across every screen that reads a macro. Because meals read their
 * numbers THROUGH the food, fixing one row here moves today's totals, the 30-day chart, and
 * every past day — so a stale `/` or `/calendar` after a save would be showing numbers the
 * database no longer holds.
 */
export type SaveState = { status: 'idle' | 'saved'; error?: string };

export async function saveFoodMacros(_previous: SaveState, form: FormData): Promise<SaveState> {
  const id = Number(form.get('food_id'));
  const name = String(form.get('name') ?? '').trim();
  if (!Number.isInteger(id) || id <= 0 || !name) {
    return { status: 'idle', error: 'Missing food' };
  }

  // An empty field means "leave this alone", which is not the same as zero. Sending 0 for a
  // blank would silently wipe a macro the user simply did not retype.
  const number = (key: string) => {
    const raw = form.get(key);
    if (raw === null || String(raw).trim() === '') return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };

  const result = await updateFood({
    food_id: id,
    name,
    calories: number('calories'),
    protein_g: number('protein_g'),
    carbs_g: number('carbs_g'),
    fat_g: number('fat_g'),
    // Typing real numbers in is what `high` means: measured, or taken from a label. Leaving the
    // flag where it was would keep the row in the review queue forever.
    confidence: 'high',
  });

  if (!result.ok) return { status: 'idle', error: result.error };

  revalidatePath('/food');
  revalidatePath('/');
  revalidatePath('/calendar', 'layout');
  return { status: 'saved' };
}
