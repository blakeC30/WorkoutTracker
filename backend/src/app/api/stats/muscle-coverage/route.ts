import { readEndpoint } from '@/lib/api-route';
import { getMuscleCoverage } from '@/lib/stats';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/*
 * Separate from /api/stats/muscles rather than replacing it. That one answers "how much tonnage
 * per region" and is what the get_volume_by_muscle MCP tool serves; this one answers "which
 * muscles are being trained at all, and which only as passengers". They disagree on purpose —
 * the volume query counts loaded sets only, which is exactly why it cannot answer this.
 *
 * No `days` parameter. The query returns 7, 14 and 28 day counts together so the dashboard's
 * window toggle costs no request; see the comment on getMuscleCoverage for why that beats a
 * parameter here.
 */
export const GET = readEndpoint(async () => getMuscleCoverage());
