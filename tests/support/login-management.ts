import { env } from "cloudflare:workers";
import { createAccessRequest, createRequestContext, getCurrentUser, type AccessActor, type AccessRequest, type CoreError, type RequestContext } from "@xpro/core/server";
import { err, type Result } from "true-myth/result";
import { expect, vi } from "vitest";
import type { SignedInLogin } from "./hub-identities";
import { createResetFixture, readResetState, type ResetFixture } from "./reset-password";
import { readResetTokens } from "./reset-password.db";
import { handleHubAuthRequest } from "./sign-in-actions";
import { withWorkspace, workspaceServices } from "./sign-in";

export type ManagementServices = { database: D1Database; access: AccessRequest; context: RequestContext };
export type ManagementError = CoreError | { code: "stms_login_not_found" | "stms_login_state_conflict"
  | "stms_self_suspend_forbidden" | "stms_self_archive_forbidden" | "accounts_email_taken"
  | "accounts_username_invalid" | "accounts_username_taken" | "accounts_username_reserved" };
export type ManagementAction<Value = { loginId: string }> =
  (input: unknown, services: ManagementServices) => Promise<Result<Value, ManagementError>>;
export type LoginSummary = { loginId: string; username: string | null; name: string; email: string;
  phone: string | null; createdAt: string; status: "active" | "suspended" | "archived" };
export type LoginPage = { logins: LoginSummary[]; nextOffset: number | null };
export type LoginDetails = LoginSummary & { workspace: { workspaceId: string; name: string } | null };
export type ManagementState = Awaited<ReturnType<typeof readResetState>>;
type UserRow = ManagementState["hub"]["users"][number];

export const suspensionReasons = ["stms_unpaid", "stms_abuse_or_misuse", "stms_security_concern",
  "stms_at_persons_request", "stms_other"] as const;

export async function createManagementFixture(): Promise<ResetFixture> {
  const fixture = await createResetFixture();
  try {
    const native = await fixture.signIn.identities.auth.$context;
    await native.internalAdapter.updateUser(fixture.target.loginId, { name: "Amber machinist" });
    await native.internalAdapter.updateUser(fixture.other.loginId, { name: "Beta planner" });
    return fixture;
  } catch (error) { await fixture.signIn.identities.db.destroy(); throw error; }
}

export async function prepareManagementServices(input: {
  actor: SignedInLogin | null; database?: D1Database;
}): Promise<ManagementServices> {
  const context = createRequestContext();
  const access = await createAccessRequest({ app: "hub", session: input.actor, workspaceId: null, hub: env.HUB_ACCESS, context });
  return { database: input.database ?? env.DB, access, context };
}

export async function suspendFixtureLogin(fixture: ResetFixture, loginId: string = fixture.target.loginId): Promise<void> {
  await fixture.signIn.identities.auth.api.banUser({ headers: { cookie: fixture.master.cookie },
    body: { userId: loginId, banReason: "stms_security_concern" } });
}

export async function archiveFixtureLogin(fixture: ResetFixture, input: {
  loginId: string; previousStatus: "active" | "suspended";
}): Promise<void> {
  const native = await fixture.signIn.identities.auth.$context;
  await fixture.signIn.identities.auth.api.revokeUserSessions({ headers: { cookie: fixture.master.cookie }, body: { userId: input.loginId } });
  await native.internalAdapter.updateUser(input.loginId, {
    archivedAt: new Date().toISOString(), statusBeforeArchiving: input.previousStatus,
  });
}

export function expectedLogin(row: UserRow, status: LoginSummary["status"]): LoginSummary {
  return { loginId: row.id, username: row.username, name: row.name, email: row.email,
    phone: row.phone, createdAt: row.createdAt, status };
}

export function findManagementUser(state: ManagementState, loginId: string): UserRow {
  const row = state.hub.users.find((item) => item.id === loginId);
  if (!row) throw new Error("The real login-management fixture must contain its login.");
  return row;
}

export async function expectManagementRefusal<Value>(input: {
  fixture: ResetFixture; action: ManagementAction<Value>; submitted: unknown;
  actor: SignedInLogin | null; error: ManagementError;
}): Promise<void> {
  const services = await prepareManagementServices({ actor: input.actor });
  const before = await readResetState(input.fixture), tokens = await readResetTokens(input.fixture);
  expect((await input.action(input.submitted, services)).toJSON()).toEqual(err(input.error).toJSON());
  expect(await readResetState(input.fixture)).toEqual(before);
  expect(await readResetTokens(input.fixture)).toEqual(tokens);
}

export async function expectManagementFailure<Value>(input: {
  fixture: ResetFixture; action: ManagementAction<Value>; operation: string; submitted: unknown; database?: D1Database;
}): Promise<void> {
  const services = await prepareManagementServices({ actor: input.fixture.master,
    ...(input.database ? { database: input.database } : {}) });
  const before = await readResetState(input.fixture), tokens = await readResetTokens(input.fixture);
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  expect((await input.action(input.submitted, services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
  expect(await readResetState(input.fixture)).toEqual(before);
  expect(await readResetTokens(input.fixture)).toEqual(tokens);
  expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: services.context.requestId,
    app: "hub", operation: input.operation })]]);
}

export async function expectManagementSaved(input: {
  fixture: ResetFixture; before: ManagementState; services: ManagementServices; loginId: string;
  userChanges: Partial<UserRow>; sessions: ManagementState["hub"]["sessions"];
  action: string; reason?: string; comment?: string;
  reservations?: ManagementState["hub"]["reservations"];
}): Promise<ManagementState> {
  const after = await readResetState(input.fixture);
  const original = findManagementUser(input.before, input.loginId);
  const audit = { id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/),
    action: input.action, outcome: "success", actorLoginId: input.fixture.master.loginId,
    affectedLoginId: input.loginId, reason: input.reason ?? null, comment: input.comment ?? null,
    requestId: input.services.context.requestId, createdAt: expect.any(String) };
  expect(after).toEqual({ ...input.before, hub: { ...input.before.hub,
    users: input.before.hub.users.map((row) => row.id === input.loginId
      ? { ...original, authRevision: original.authRevision + 1, ...input.userChanges, updatedAt: expect.any(String) } : row),
    sessions: input.sessions,
    reservations: input.reservations ?? input.before.hub.reservations,
    audits: expect.arrayContaining([...input.before.hub.audits, audit]),
  } });
  expect(after.hub.audits).toHaveLength(input.before.hub.audits.length + 1);
  const saved = after.hub.audits.filter((row) => row.requestId === input.services.context.requestId);
  expect(saved).toEqual([audit]);
  expect(saved[0]?.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  const serialized = JSON.stringify(saved);
  for (const secret of [input.fixture.target.email, original.username, ...input.fixture.devices.map((device) => device.cookie),
    ...input.before.hub.credentials.map((credential) => credential.password)]) {
    if (secret) expect(serialized).not.toContain(secret);
  }
  return after;
}

export async function managementLocalAccess(input: {
  fixture: ResetFixture; workspace: ResetFixture["workspace"]; cookie: string;
}): Promise<Result<AccessActor, CoreError>> {
  return await withWorkspace(input.workspace, async ({ storage }) => await getCurrentUser(
    new Request(input.workspace.origin + "/private-work", { headers: { cookie: input.cookie } }),
    workspaceServices({ fixture: input.fixture.signIn, workspace: input.workspace, storage }, handleHubAuthRequest),
  ));
}

export function unavailableManagementDatabase(): D1Database {
  return new Proxy(env.DB, { get(target, property, receiver) {
    if (property === "prepare") return () => { throw new Error("private_management_database_failure"); };
    const value: unknown = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

export async function prepareManagementRefreshTokens(fixture: ResetFixture): Promise<void> {
  const native = await fixture.signIn.identities.auth.$context;
  for (const input of [{ login: fixture.target, revoked: null }, { login: fixture.target, revoked: new Date(0) }, { login: fixture.other, revoked: null }]) {
    // Native provider setup only; the application's refresh grant remains disabled.
    await native.adapter.create({ model: "oauthRefreshToken", data: {
      token: crypto.randomUUID(), clientId: fixture.workspace.clientId, userId: input.login.loginId,
      sessionId: input.login.hubSessionId, scopes: ["openid"], createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000), revoked: input.revoked,
    } });
  }
}

export async function expectManagementTokensEnded(input: {
  fixture: ResetFixture; before: Awaited<ReturnType<typeof readResetTokens>>; revokedAt: string; loginId: string;
}): Promise<void> {
  const expected = (rows: typeof input.before.access) => rows.map((row) => row.userId === input.loginId
    ? { ...row, revoked: row.revoked ?? input.revokedAt, sessionId: null } : row);
  expect(await readResetTokens(input.fixture)).toEqual({ access: expected(input.before.access), refresh: expected(input.before.refresh) });
}
