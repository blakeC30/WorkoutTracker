import { readEndpoint, intParam } from '@/lib/api-route';
import { getPrs } from '@/lib/stats';

// The ceiling is 200 rather than 100 because the dashboard asks for one more row than it
// displays in order to detect truncation. A lower ceiling here would clamp that probe and the
// list would silently hide rows again — the thing the probe exists to prevent.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = readEndpoint(async (params) => getPrs({ exercise: params.get('exercise') ?? undefined, limit: intParam(params, 'limit', 25, 200) }));
