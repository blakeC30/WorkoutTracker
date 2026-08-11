import { readEndpoint, intParam } from '@/lib/api-route';
import { getVolumeByMuscle } from '@/lib/stats';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = readEndpoint(async (params) => getVolumeByMuscle(intParam(params, 'days', 28, 365)));
