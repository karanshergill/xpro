import { is, pipe, string, uuid } from "valibot";

export function readDirectDestination(search: string): string | null {
  const query = new URLSearchParams(search), workspace = query.get("requestedWorkspaceId");
  if (workspace === null) return "/auth/destination";
  if (query.getAll("requestedWorkspaceId").length !== 1 || !is(pipe(string(), uuid()), workspace)) return null;
  return "/auth/destination?" + new URLSearchParams({ requestedWorkspaceId: workspace });
}
