import { readEndpoint, intParam } from '@/lib/api-route';
import { getReviewQueue } from '@/lib/stats';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = readEndpoint(async (params) => getReviewQueue(intParam(params, 'limit', 25, 100)));
