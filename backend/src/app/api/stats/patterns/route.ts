import { readEndpoint, intParam } from '@/lib/api-route';
import { getVolumeByPattern } from '@/lib/stats';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = readEndpoint(async (params) => getVolumeByPattern(intParam(params, 'days', 28, 365)));
