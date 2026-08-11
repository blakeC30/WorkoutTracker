import { readEndpoint, intParam } from '@/lib/api-route';
import { getPrs } from '@/lib/stats';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = readEndpoint(async (params) => getPrs({ exercise: params.get('exercise') ?? undefined, limit: intParam(params, 'limit', 25, 100) }));
