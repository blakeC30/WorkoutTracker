import { readEndpoint, intParam } from '@/lib/api-route';
import { getWeeklySummary } from '@/lib/stats';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = readEndpoint(async (params) => getWeeklySummary(intParam(params, 'weeks', 8, 52)));
