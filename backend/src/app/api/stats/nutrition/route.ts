import { readEndpoint, intParam } from '@/lib/api-route';
import { getDailyNutrition } from '@/lib/stats';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = readEndpoint(async (params) => getDailyNutrition(intParam(params, 'days', 30, 365)));
