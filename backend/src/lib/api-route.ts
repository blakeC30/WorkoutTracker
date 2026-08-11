import { isAuthorized, rejected } from './auth';

/**
 * Wraps a read-only dashboard endpoint with the shared-secret check.
 *
 * These are called server-side from web/, which sends `Authorization: Bearer <API_SECRET>`.
 * There's no path-secret variant here: unlike the MCP endpoint, nothing needs to work from
 * a client that can only be handed a URL, so the secret stays in a header where it belongs.
 */
export function readEndpoint(
  handler: (params: URLSearchParams) => Promise<unknown>,
) {
  return async function GET(request: Request): Promise<Response> {
    if (!isAuthorized({ request })) return rejected();

    try {
      const url = new URL(request.url);
      const data = await handler(url.searchParams);
      return Response.json({ ok: true, data });
    } catch (error) {
      // Log the real error server-side; return a generic message. A stack trace in the
      // response body would leak schema details to anyone probing the endpoint.
      console.error('[api] request failed:', error);
      return Response.json(
        { ok: false, error: error instanceof Error ? error.message : 'Query failed' },
        { status: 500 },
      );
    }
  };
}

/**
 * The write counterpart. Same shared-secret check, POST body instead of query params.
 *
 * Kept separate from `readEndpoint` rather than adding a method switch, because the two have
 * genuinely different risk: a read that leaks is a disclosure, a write that gets through is
 * corruption of the log. Anything that can change data should be visibly a different thing in
 * the codebase.
 *
 * The handler validates its own body — this wrapper deliberately does not trust an untyped
 * object into a query.
 */
export function writeEndpoint<T>(
  parse: (body: unknown) => T,
  handler: (input: T) => Promise<unknown>,
) {
  return async function POST(request: Request): Promise<Response> {
    if (!isAuthorized({ request })) return rejected();

    let input: T;
    try {
      input = parse(await request.json());
    } catch (error) {
      // A validation failure is the caller's fault and safe to describe: it says which field is
      // wrong, and reveals nothing that isn't already in the tool schema.
      return Response.json(
        { ok: false, error: error instanceof Error ? error.message : 'Invalid request body' },
        { status: 400 },
      );
    }

    try {
      return Response.json({ ok: true, data: await handler(input) });
    } catch (error) {
      console.error('[api] write failed:', error);
      return Response.json({ ok: false, error: 'Write failed' }, { status: 500 });
    }
  };
}

/** Reads a positive integer query param, falling back when absent or nonsense. */
export function intParam(params: URLSearchParams, name: string, fallback: number, max: number) {
  const raw = params.get(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}
