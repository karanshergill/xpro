import { parseInput, reportUnexpectedError, type AccessRequest, type CoreError, type RequestContext } from "@xpro/core/server";
import { err, ok, type Result } from "true-myth/result";
import { checkUsername, type UsernameError } from "#check-username/check-username.db.ts";
import { normalizePhone } from "#profile/profile.ts";
import { hasCreationEmail, hasCreationWorkspace, prepareLoginCreation, readCreatedLogin, readCreationMembership,
  type CreatedLogin, type CreationError, type LoginCreation } from "./create-login.db";
import { createLoginEntries } from "./input";

export type CreateLoginError = CoreError | CreationError | UsernameError | { code: "accounts_email_taken" };
export type LoginCreationIdentity = {
  hasCreationPermission(workspaceId: string): Promise<boolean>;
  createUser(input: { creation: LoginCreation; password: string }): Promise<void>;
  ensureCredential(input: { loginId: string; password: string }): Promise<"ready" | "invalid">;
  addMember(input: { loginId: string; workspaceId: string }): Promise<void>;
};
export type CreateLoginServices = {
  database: D1Database; access: AccessRequest; identity: LoginCreationIdentity; context: RequestContext;
};
// This is the native-record checkpoint, not a completed public creation response.
// The caller must confirm the workspace save and atomically audit/complete creation.
export type PreparedLoginCreation = { creation: LoginCreation; loginId: string };
type Preparation = Result<PreparedLoginCreation, CreateLoginError>;

export async function createLogin(input: unknown, services: CreateLoginServices): Promise<Preparation> {
  const actor = services.access.authorize({ kind: "protected", hasLocalPermission: true });
  if (actor.isErr) return err(actor.error);
  const parsed = parseInput(input, createLoginEntries);
  if (parsed.isErr) return err(parsed.error);
  const submitted = parsed.value;
  if ((submitted.workspaceId === undefined) !== (submitted.kind === undefined)) {
    return err({ code: "core_invalid_input", fields: ["workspaceId", "kind"] });
  }
  try {
    if (!actor.value.isMaster && (submitted.workspaceId === undefined
      || !await services.identity.hasCreationPermission(submitted.workspaceId))) return err({ code: "core_forbidden" });
    if (submitted.workspaceId !== undefined && !await hasCreationWorkspace(services.database, submitted.workspaceId)) {
      return err({ code: "core_forbidden" });
    }
    const phone = normalizePhone(submitted.phone);
    if (phone === null) return err({ code: "core_invalid_input", fields: ["phone"] });
    const prepared = await prepareLoginCreation(services.database, {
      creationId: submitted.creationId, creatorLoginId: actor.value.loginId,
      workspaceId: submitted.workspaceId ?? null, kind: submitted.kind ?? null,
      details: { email: submitted.email, username: submitted.username, name: submitted.name, phone },
    });
    if (prepared.isErr) return err(prepared.error);
    const creation = prepared.value;
    const linked = await ensureCreatedLogin({ creation, password: submitted.password }, services);
    if (linked.isErr) return err(linked.error);
    const login = linked.value;
    if (creation.completedAt !== null) {
      return creation.createdLoginId === login.loginId ? ok({ creation, loginId: login.loginId })
        : err({ code: "accounts_creation_conflict" });
    }
    if (creation.createdLoginId !== null || !matchesPendingLogin(login, creation)) return err({ code: "accounts_creation_conflict" });
    const credential = await services.identity.ensureCredential({ loginId: login.loginId, password: submitted.password });
    if (credential !== "ready") return err({ code: "accounts_creation_conflict" });
    const membership = await ensureMembership({ creation, loginId: login.loginId }, services);
    if (membership.isErr) return err(membership.error);
    return ok({ creation, loginId: login.loginId });
  } catch {
    reportUnexpectedError(services.context, { app: "hub", operation: "accounts_create_login" });
    return err({ code: "core_unexpected_error" });
  }
}

async function ensureCreatedLogin(input: { creation: LoginCreation; password: string }, services: CreateLoginServices): Promise<Result<CreatedLogin, CreateLoginError>> {
  const { creation, password } = input;
  const linked = await readCreatedLogin(services.database, creation.id);
  if (linked) return ok(linked);
  if (creation.completedAt !== null || creation.createdLoginId !== null) return err({ code: "accounts_creation_conflict" });
  try {
    const available = await checkIdentifiers(services.database, creation);
    if (available.isErr) {
      // A concurrent attempt may have inserted this same linked user meanwhile.
      const concurrent = await readCreatedLogin(services.database, creation.id);
      return concurrent ? ok(concurrent) : err(available.error);
    }
    await services.identity.createUser({ creation, password });
  } catch (error) {
    // Native user and credential writes are separate. Only the initial link permits recovery.
    const concurrent = await readCreatedLogin(services.database, creation.id);
    if (concurrent) return ok(concurrent);
    const available = await checkIdentifiers(services.database, creation);
    if (available.isErr) return err(available.error);
    throw error;
  }
  const created = await readCreatedLogin(services.database, creation.id);
  if (!created) throw new Error("The native login was not saved with its creation reference.");
  return ok(created);
}

async function checkIdentifiers(database: D1Database, creation: LoginCreation): Promise<Result<void, CreateLoginError>> {
  const username = await checkUsername(database, creation.details.username);
  if (username.isErr) return err(username.error);
  return await hasCreationEmail(database, creation.details.email) ? err({ code: "accounts_email_taken" }) : ok(undefined);
}

async function ensureMembership(input: PreparedLoginCreation, services: CreateLoginServices): Promise<Result<void, CreationError>> {
  const { creation, loginId } = input;
  const member = await readCreationMembership(services.database, loginId);
  if (member) {
    return member.workspaceId === creation.workspaceId ? ok(undefined) : err({ code: "accounts_creation_conflict" });
  }
  if (creation.workspaceId === null) return ok(undefined);
  try { await services.identity.addMember({ loginId, workspaceId: creation.workspaceId }); }
  catch (error) {
    const concurrent = await readCreationMembership(services.database, loginId);
    if (concurrent?.workspaceId !== creation.workspaceId) throw error;
  }
  return ok(undefined);
}

function matchesPendingLogin(login: CreatedLogin, creation: LoginCreation): boolean {
  const { details } = creation;
  return login.email === details.email && login.username === details.username && login.name === details.name
    && login.phone === details.phone && login.role === "user" && login.banned !== 1 && login.archivedAt === null;
}
