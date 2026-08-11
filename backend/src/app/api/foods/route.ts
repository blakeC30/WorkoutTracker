import { z } from 'zod';
import { writeEndpoint } from '@/lib/api-route';
import { saveFood } from '@/lib/queries';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Correcting a food from the dashboard.
 *
 * This is the same operation the `save_food` MCP tool performs, and it has the same reach:
 * macros are read THROUGH the link, so changing them here moves every meal ever logged with
 * this food, including past days' totals. That is the point of the catalog, and the UI says so
 * before you press save.
 *
 * `food_id` is required. Creating foods stays with the logging path, where there is a
 * conversation to establish what the thing actually is — a dashboard field would only ever
 * produce half-specified catalog entries.
 */
const body = z.object({
  food_id: z.number().int().positive(),
  name: z.string().min(1),
  unit_label: z.string().min(1).optional(),
  calories: z.number().nonnegative().optional(),
  protein_g: z.number().nonnegative().optional(),
  carbs_g: z.number().nonnegative().optional(),
  fat_g: z.number().nonnegative().optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
});

export const POST = writeEndpoint(
  (raw) => body.parse(raw),
  async (input) => saveFood(input),
);
