import { readEndpoint } from '@/lib/api-route';
import { getDay, isIsoDate } from '@/lib/day';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = readEndpoint(async (params) => {
  const date = params.get('date');
  if (!isIsoDate(date)) throw new Error('date is required, as YYYY-MM-DD');
  return getDay(date);
});
