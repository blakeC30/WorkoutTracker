import { readEndpoint, intParam } from '@/lib/api-route';
import { getMonthlyConsistency } from '@/lib/day';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = readEndpoint(async (params) => getMonthlyConsistency(intParam(params, 'months', 6, 24)));
