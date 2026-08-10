import { isAuthorized, unauthorized } from '@/lib/auth';
import { mcpHandler } from '@/lib/mcp';

/**
 * The MCP endpoint, with the shared secret in the URL path:
 *
 *   https://your-backend.vercel.app/api/mcp/<API_SECRET>
 *
 * Claude's connector dialog always accepts a plain URL, so this works on every plan today.
 * (Its request-header auth — which would be tidier — is still a gated beta. When you get
 * access, /api/mcp with an Authorization header works too; see ../route.ts.)
 *
 * Treat this URL like a password: anyone who has it can read and write your training log.
 */

// Vercel Hobby allows up to 60s. 30 is plenty for a few Postgres round trips and leaves
// headroom rather than sitting at the ceiling.
export const maxDuration = 30;

// Never cache MCP responses — every call is a live read or write.
export const dynamic = 'force-dynamic';

async function handle(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
): Promise<Response> {
  // Next 16 gives route params as a Promise.
  const { secret } = await params;

  if (!isAuthorized({ pathSecret: secret, request })) {
    return unauthorized();
  }

  return mcpHandler(request);
}

export { handle as GET, handle as POST, handle as DELETE };
