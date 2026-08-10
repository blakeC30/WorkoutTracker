import { isAuthorized, unauthorized } from '@/lib/auth';
import { mcpHandler } from '@/lib/mcp';

/**
 * The same MCP endpoint, authenticated with a header instead of a URL path segment:
 *
 *   curl -H "Authorization: Bearer $API_SECRET" https://your-backend.vercel.app/api/mcp
 *
 * This is the better mechanism — secrets in URLs end up in logs and browser history — but
 * Claude's connector request-header auth is a gated beta, so ./[secret]/route.ts is the
 * one to point the connector at for now. This route makes curl testing easy and means
 * switching over later is a connector settings change, not a code change.
 */

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<Response> {
  if (!isAuthorized({ request })) {
    return unauthorized();
  }
  return mcpHandler(request);
}

export { handle as GET, handle as POST, handle as DELETE };
