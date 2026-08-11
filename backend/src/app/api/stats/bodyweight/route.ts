import { readEndpoint, intParam } from '@/lib/api-route';
import { getBodyweightTrend } from '@/lib/stats';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = readEndpoint(async (params) => getBodyweightTrend(intParam(params, 'days', 90, 365)));
