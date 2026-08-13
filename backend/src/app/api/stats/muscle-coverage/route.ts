import { readEndpoint, intParam } from '@/lib/api-route';
import { getMuscleCoverage } from '@/lib/stats';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/*
 * Separate from /api/stats/muscles rather than replacing it. That one answers "how much tonnage
 * per region" and is what the get_volume_by_muscle MCP tool serves; this one answers "which
 * muscles are being trained at all, and which only as passengers". They disagree on purpose —
 * the volume query counts loaded sets only, which is exactly why it cannot answer this.
 */
export const GET = readEndpoint(async (params) =>
  getMuscleCoverage(intParam(params, 'days', 28, 365)),
);
