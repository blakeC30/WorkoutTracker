import { readEndpoint } from '@/lib/api-route';
import { getPatternRecency } from '@/lib/day';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = readEndpoint(async () => getPatternRecency());
