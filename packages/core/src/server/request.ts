import { is, pipe, string, uuid } from "valibot";

export const requestIdHeader = "x-request-id";
const requestIdSchema = pipe(string(), uuid());

export type RequestContext = { requestId: string };

export function createRequestContext(): RequestContext {
  return { requestId: crypto.randomUUID() };
}

// Use only after the public entry point has assigned its own request ID.
// A forwarded ID is a correlation hint, never identity or permission proof.
export function readForwardedRequestContext(request: Request): RequestContext {
  const requestId = request.headers.get(requestIdHeader);
  return is(requestIdSchema, requestId) ? { requestId } : createRequestContext();
}
