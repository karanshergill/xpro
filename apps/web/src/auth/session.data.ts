import { getWorkspacePage } from "#functions/workspace-page.functions.ts";
import { readSessionFailure, readWorkspacePageResult, type WorkspacePage } from "./session";

export async function loadWorkspacePage(signal?: AbortSignal): Promise<WorkspacePage> {
  // This fresh read intentionally omits the document's identity precondition:
  // the controller must compare the actual current login before resuming.
  let refusal: Response | undefined;
  const result = await getWorkspacePage({ data: {}, signal, fetch: async (url, options) => {
    const response = await fetch(url, { ...options, cache: "no-store" });
    // The Worker can refuse before Start wraps the handler's raw Response.
    // Preserve that HTTP response before Start parses plain JSON as RPC data.
    if (!response.ok) refusal = response.clone();
    return response;
  } });
  const response = refusal ?? result;
  if (!response.ok) return { status: "error", error: readSessionFailure(await response.json()) };
  const loginId = readWorkspacePageResult(await response.json());
  return loginId ? { status: "ready", loginId } : { status: "error", error: { code: "core_unexpected_error" } };
}
