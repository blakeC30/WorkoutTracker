import { readEndpoint, intParam } from '@/lib/api-route';
import { getExerciseHistory } from '@/lib/stats';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = readEndpoint(async (params) => {
  const name = params.get('name');
  if (!name) throw new Error('name is required');
  return getExerciseHistory(name, intParam(params, 'limit', 120, 400));
});
