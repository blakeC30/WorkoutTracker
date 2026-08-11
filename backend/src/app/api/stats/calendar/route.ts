import { readEndpoint } from '@/lib/api-route';
import { getCalendar, isIsoDate } from '@/lib/day';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const GET = readEndpoint(async (params) => {
  const from = params.get('from');
  const to = params.get('to');
  // Validated rather than defaulted. A malformed range here would silently return the wrong
  // month, and a calendar quietly showing August's data under a September heading is worse
  // than an error.
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new Error('from and to are required, as YYYY-MM-DD');
  }
  return getCalendar(from, to);
});
