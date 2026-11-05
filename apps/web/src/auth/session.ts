import { object, optional, picklist, pipe, safeParse, string, uuid } from "valibot";

export type WorkspacePage = { status: "ready"; loginId: string } | { status: "error"; error: SessionFailure };
export type SessionFailure = { code: string; requestId?: string };
export type SessionFailureEvent = SessionFailure & { startedAt: number };
export const sessionFailureEventName = "xpro:session-failed";
const pageSchema = object({ loginId: pipe(string(), uuid()) });
const failureSchema = object({ code: string(), requestId: optional(pipe(string(), uuid())) });
const sessionCodeSchema = picklist(["core_unauthenticated", "core_identity_changed", "core_login_inactive",
  "core_forbidden", "core_creation_incomplete", "core_profile_incomplete"]);

export function readWorkspacePageResult(input: unknown): string | null {
  const parsed = safeParse(pageSchema, input);
  return parsed.success ? parsed.output.loginId : null;
}

export function readSessionFailure(input: unknown): SessionFailure {
  const parsed = safeParse(failureSchema, input);
  return parsed.success ? parsed.output : { code: "core_unexpected_error" };
}

export function isSessionFailure(code: string): boolean {
  return safeParse(sessionCodeSchema, code).success;
}
