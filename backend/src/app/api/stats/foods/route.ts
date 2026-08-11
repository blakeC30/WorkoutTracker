import { readEndpoint, intParam } from '@/lib/api-route';
import { getFoods } from '@/lib/stats';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = readEndpoint(async (params) =>
  getFoods(intParam(params, 'days', 30, 365), intParam(params, 'limit', 60, 200)),
);
