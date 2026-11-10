import { env } from "cloudflare:workers";
import { createAccessRequest, createRequestContext, type ProfileField, type AccessRequest, type CoreError, type RequestContext } from "@xpro/core/server";
import type { CreatedLogin, HubIdentities, SignedInLogin } from "#test/hub-identities";
import { createEnrolledMaster, createMfaFixture, type MfaFixture } from "#test/master-mfa";
import { saveHub } from "#test/hub-access";
import { CompiledQuery, sql } from "kysely";
import { err, ok, type Result } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { completeFirstSignIn as complete } from "./complete-first-sign-in.server";
import { firstSignInSaveQueries } from "./complete-first-sign-in.db";

type FirstSignInInput = {
  username?: string; name?: string; phone?: { country: string; number: string }; isUsernameConfirmed?: boolean;
};
type FirstSignInContext = { database: D1Database; access: AccessRequest; context: RequestContext };
type FirstSignInError = CoreError | { code: "accounts_username_invalid" | "accounts_username_taken" | "accounts_username_reserved"
  | "accounts_username_confirmation_required" | "accounts_username_locked" };
// This signature defines T015's boundary without supplying an implementation.
const completeFirstSignIn: (input: unknown, context: FirstSignInContext) => Promise<Result<{ loginId: string }, FirstSignInError>> = complete;
const origin = "https://hub.example.test";
let identities: HubIdentities;
let mfa: MfaFixture;

beforeEach(async () => { mfa = await createMfaFixture(env.DB); identities = mfa.identities; });
afterEach(async () => { await identities.db.destroy(); vi.restoreAllMocks(); });

describe("Story 1 — complete first sign-in", () => {
  it("when a privately created login has complete and valid details then sign-in permits continuing without profile completion", async () => {
    await prepareOtherWorkspace();
    const created = await identities.createLogin();
    const before = await readHubState();
    const login = await identities.signInAgain(created);
    const context = await prepareRequest(login);
    expect(context.access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(ok({ loginId: login.loginId, isMaster: false, membershipRole: null }).toJSON());
    await expectOnlyNewSession({ before, login });
  });

  it.each([
    { input: { username: null }, fields: ["username"] },
    { input: { name: "" }, fields: ["name"] },
    { input: { phone: null }, fields: ["phone"] },
    { input: { username: null, name: "", phone: null }, fields: ["username", "name", "phone"] },
  ] as const)("when a login is missing $fields then only those fields are required before continuing", async ({ input, fields }) => {
    await prepareOtherWorkspace();
    const created = await identities.createLogin(input);
    const before = await readHubState();
    const login = await identities.signInAgain(created);
    const context = await prepareRequest(login);
    expect(context.access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_profile_incomplete", fields }).toJSON());
    await expectOnlyNewSession({ before, login });
    const missing: readonly ProfileField[] = fields;
    const values = validInput();
    const submitted: FirstSignInInput = {};
    for (const field of fields) {
      if (field === "username") { submitted.username = values.username; submitted.isUsernameConfirmed = true; }
      if (field === "name") submitted.name = values.name;
      if (field === "phone") submitted.phone = values.phone;
    }
    const beforeSave = await readHubState();
    expect((await completeFirstSignIn(submitted, await prepareRequest(login))).toJSON()).toEqual(ok({ loginId: login.loginId }).toJSON());
    const oldProfile = getProfileFrom(beforeSave, login.loginId);
    await expectSaved({ login, before: beforeSave, profile: {
      username: missing.includes("username") ? values.username : oldProfile.username,
      name: missing.includes("name") ? values.name : oldProfile.name,
      phone: missing.includes("phone") ? "+12025550123" : oldProfile.phone,
    } });
    expect((await prepareRequest(login)).access.authorize({ kind: "protected", hasLocalPermission: true }).isOk).toBe(true);
  });

  it("when stored details are invalid then completing them restores access without creating an Account or workspace", async () => {
    const login = await prepareSubject();
    await saveHub(env.DB, [identities.db.updateTable("user").set({ username: "1bad", name: " ", phone: "invalid" }).where("id", "=", login.loginId).compile()]);
    const access = await prepareRequest(login);
    expect(access.access.authorize({ kind: "protected", hasLocalPermission: true }).toJSON())
      .toEqual(err({ code: "core_profile_incomplete", fields: ["username", "name", "phone"] }).toJSON());
    const input = validInput();
    const before = await readHubState();
    expect((await completeFirstSignIn(input, access)).toJSON()).toEqual(ok({ loginId: login.loginId }).toJSON());
    await expectSaved({ login, before, profile: { username: input.username, name: input.name, phone: "+12025550123" } });
  });

  it.each(["empty Hub", "existing workspace"] as const)("when a public visitor tries registration against a %s then no login or Account is created", async (state) => {
    if (state === "existing workspace") await prepareOtherWorkspace();
    const before = await readHubState();
    const body = { email: `public-${crypto.randomUUID()}@example.test`, password: "Public-signup123!", name: "Public visitor", role: "admin" };
    const response = await identities.auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(404);
    await expect(identities.auth.api.signUpEmail({ body })).rejects.toMatchObject({ statusCode: 400, body: { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" } });
    expect(await readHubState()).toEqual(before);
  });

  it.each(["abc", "abcdefghi", "1abc", "Abcd", "a bcd", "ábcd"])("when the proposed username %s breaks the rules then the save is refused with the reason", async (username) => {
    const login = await prepareSubject({ username: null });
    const before = await readHubState();
    expect((await completeFirstSignIn({ username, isUsernameConfirmed: true }, await prepareRequest(login))).toJSON())
      .toEqual(err({ code: "accounts_username_invalid" }).toJSON());
    expect(await readHubState()).toEqual(before);
  });

  it.each(["active", "suspended", "archived"] as const)("when a username is already taken (%s login) then it remains unavailable", async (state) => {
    const login = await prepareSubject({ username: null });
    const other = await identities.signIn();
    if (state !== "active") await saveHub(env.DB, [identities.db.updateTable("user")
      .set(state === "suspended" ? { banned: 1 } : { archivedAt: new Date().toISOString() }).where("id", "=", other.loginId).compile()]);
    const profile = await readProfile(other.loginId);
    const before = await readHubState();
    expect((await completeFirstSignIn({ username: profile.username, isUsernameConfirmed: true }, await prepareRequest(login))).toJSON())
      .toEqual(err({ code: "accounts_username_taken" }).toJSON());
    expect(await readHubState()).toEqual(before);
  });

  it("when a username is reserved then the save is refused with that reason", async () => {
    const login = await prepareSubject({ username: null });
    const username = makeUsername();
    await saveHub(env.DB, [identities.db.insertInto("reservedUsernames")
      .values({ id: crypto.randomUUID(), username, addedAt: new Date().toISOString() }).compile()]);
    const before = await readHubState();
    expect((await completeFirstSignIn({ username, isUsernameConfirmed: true }, await prepareRequest(login))).toJSON())
      .toEqual(err({ code: "accounts_username_reserved" }).toJSON());
    expect(await readHubState()).toEqual(before);
  });

  it.each([undefined, false])("when username confirmation is %s then a valid choice is not saved", async (isUsernameConfirmed) => {
    const login = await prepareSubject({ username: null });
    const before = await readHubState();
    expect((await completeFirstSignIn({ username: makeUsername(), ...(isUsernameConfirmed === undefined ? {} : { isUsernameConfirmed }) }, await prepareRequest(login))).toJSON())
      .toEqual(err({ code: "accounts_username_confirmation_required" }).toJSON());
    expect(await readHubState()).toEqual(before);
  });

  it.each(["abcd", "a-b.c_12"])("when the approved username %s is confirmed then it can be saved", async (username) => {
    const login = await prepareSubject({ username: null });
    const context = await prepareRequest(login);
    const before = await readHubState();
    expect((await completeFirstSignIn({ username, isUsernameConfirmed: true }, context)).toJSON())
      .toEqual(ok({ loginId: login.loginId }).toJSON());
    await expectSaved({ login, before, profile: { ...getProfileFrom(before, login.loginId), username }, context });
  });

  it.each(["user", "admin"] as const)("when a %s confirms the first username then only that login's missing details are saved", async (role) => {
    const login = await prepareSubject({ role, username: null, name: "", phone: null });
    const context = await prepareRequest(login);
    const input = validInput();
    const before = await readHubState();
    expect((await completeFirstSignIn(input, context)).toJSON()).toEqual(ok({ loginId: login.loginId }).toJSON());
    await expectSaved({ login, before, profile: { username: input.username, name: input.name, phone: "+12025550123" }, context });
  });

  it("when the selected country and national number are valid then the phone is saved in international format", async () => {
    const login = await prepareSubject({ phone: null });
    const before = await readHubState();
    expect((await completeFirstSignIn({ phone: { country: "GB", number: "020 7946 0123" } }, await prepareRequest(login))).toJSON())
      .toEqual(ok({ loginId: login.loginId }).toJSON());
    await expectSaved({ login, before, profile: { ...getProfileFrom(before, login.loginId), phone: "+442079460123" } });
  });

  it("when name and phone are invalid in a direct server call then both field names are returned without saving", async () => {
    const login = await prepareSubject({ name: "", phone: null });
    const before = await readHubState();
    expect((await completeFirstSignIn({ name: " ", phone: { country: "ZZ", number: "invalid" } }, await prepareRequest(login))).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: ["name", "phone"] }).toJSON());
    expect(await readHubState()).toEqual(before);
  });

  it.each([{ country: "US", number: "1111111111" }, { country: "ZZ", number: "2025550123" }])(
    "when a country or phone number is invalid ($country, $number) then it is refused", async (phone) => {
      const login = await prepareSubject({ phone: null });
      const before = await readHubState();
      expect((await completeFirstSignIn({ phone }, await prepareRequest(login))).toJSON())
        .toEqual(err({ code: "core_invalid_input", fields: ["phone"] }).toJSON());
      expect(await readHubState()).toEqual(before);
    },
  );

  it("when required details are omitted from a direct call then all missing fields are reported without a partial save", async () => {
    const login = await prepareSubject({ username: null, name: "", phone: null });
    const before = await readHubState();
    expect((await completeFirstSignIn({ name: "Completed person" }, await prepareRequest(login))).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: ["username", "phone"] }).toJSON());
    expect(await readHubState()).toEqual(before);
  });

  it("when a valid username is already present then completion cannot change it", async () => {
    const login = await prepareSubject({ phone: null });
    const before = await readHubState();
    expect((await completeFirstSignIn({ username: makeUsername(), isUsernameConfirmed: true,
      phone: { country: "US", number: "2025550123" } }, await prepareRequest(login))).toJSON())
      .toEqual(err({ code: "accounts_username_locked" }).toJSON());
    expect(await readHubState()).toEqual(before);
  });

  it("when the same confirmed submission is repeated then the saved choice and single audit entry are preserved", async () => {
    const login = await prepareSubject({ username: null, name: "", phone: null });
    const input = validInput();
    expect((await completeFirstSignIn(input, await prepareRequest(login))).toJSON()).toEqual(ok({ loginId: login.loginId }).toJSON());
    const saved = await readHubState();
    expect((await completeFirstSignIn(input, await prepareRequest(login))).toJSON()).toEqual(ok({ loginId: login.loginId }).toJSON());
    expect(await readHubState()).toEqual(saved);
    expect(saved.auditEntries.filter((entry) => entry.affectedLoginId === login.loginId)).toHaveLength(1);
  });

  it("when two people confirm the same available username concurrently then exactly one receives it", async () => {
    const first = await prepareSubject({ username: null });
    const second = await identities.signIn({ username: null });
    const input = { username: makeUsername(), isUsernameConfirmed: true };
    const before = await readHubState();
    const [firstContext, secondContext] = await Promise.all([prepareRequest(first), prepareRequest(second)]);
    const results = await Promise.all([completeFirstSignIn(input, firstContext), completeFirstSignIn(input, secondContext)]);
    expect(results.filter((result) => result.isOk).length).toBe(1);
    expect(results.filter((result) => result.isErr).map((result) => result.toJSON()))
      .toEqual([err({ code: "accounts_username_taken" }).toJSON()]);
    const winner = results[0]?.isOk ? first : second;
    await expectSaved({ login: winner, before, profile: { ...getProfileFrom(before, winner.loginId), username: input.username } });
  });

  it("when two requests choose different first usernames for one login concurrently then the first saved choice cannot be overwritten", async () => {
    const login = await prepareSubject({ username: null });
    const choices = [makeUsername(), makeUsername()];
    const before = await readHubState();
    const contexts = await Promise.all(choices.map(async () => await prepareRequest(login)));
    const results = await Promise.all(choices.map(async (username, index) => {
      const context = contexts[index];
      if (!context) throw new Error("A request context is required.");
      return await completeFirstSignIn({ username, isUsernameConfirmed: true }, context);
    }));
    expect(results.filter((result) => result.isOk).length).toBe(1);
    expect(results.filter((result) => result.isErr).map((result) => result.toJSON()))
      .toEqual([err({ code: "accounts_username_locked" }).toJSON()]);
    const username = choices[results.findIndex((result) => result.isOk)];
    if (!username) throw new Error("One request must have saved its choice.");
    await expectSaved({ login, before, profile: { ...getProfileFrom(before, login.loginId), username } });
  });

  it("when two requests confirm the same first username for one login concurrently then both see the saved result and only one audit is recorded", async () => {
    const login = await prepareSubject({ username: null, name: "", phone: null });
    const input = validInput();
    const before = await readHubState();
    const contexts = await Promise.all([prepareRequest(login), prepareRequest(login)]);
    const results = await Promise.all(contexts.map(async (context) => await completeFirstSignIn(input, context)));
    expect(results.map((result) => result.toJSON())).toEqual([
      ok({ loginId: login.loginId }).toJSON(), ok({ loginId: login.loginId }).toJSON(),
    ]);
    await expectSaved({ login, before, profile: { username: input.username, name: input.name, phone: "+12025550123" } });
  });

  it("when there is no authenticated session then a direct completion call is refused", async () => {
    await prepareOtherWorkspace();
    const before = await readHubState();
    expect((await completeFirstSignIn(validInput(), await prepareRequest(null))).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(await readHubState()).toEqual(before);
  });

  it.each([null, []])("when a direct call supplies a non-object payload (%j) then it is refused safely", async (input) => {
    const login = await prepareSubject({ username: null });
    const before = await readHubState();
    expect((await completeFirstSignIn(input, await prepareRequest(login))).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: [] }).toJSON());
    expect(await readHubState()).toEqual(before);
  });

  it("when a real session has ended then completion cannot save any details", async () => {
    const login = await prepareSubject({ username: null });
    await identities.auth.api.signOut({ headers: { cookie: login.cookie } });
    const before = await readHubState();
    expect((await completeFirstSignIn({ username: makeUsername(), isUsernameConfirmed: true }, await prepareRequest(login))).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(await readHubState()).toEqual(before);
  });

  it.each(["banned", "archivedAt"] as const)("when the signed-in login becomes %s then completion cannot save details", async (field) => {
    const login = await prepareSubject({ username: null });
    await saveHub(env.DB, [identities.db.updateTable("user").set(field, field === "banned" ? 1 : new Date().toISOString()).where("id", "=", login.loginId).compile()]);
    const before = await readHubState();
    expect((await completeFirstSignIn({ username: makeUsername(), isUsernameConfirmed: true }, await prepareRequest(login))).toJSON())
      .toEqual(err({ code: "core_login_inactive" }).toJSON());
    expect(await readHubState()).toEqual(before);
  });

  it("when login creation is unfinished then even a complete submission cannot finish the profile", async () => {
    const login = await prepareSubject({ username: null });
    const id = crypto.randomUUID();
    await saveHub(env.DB, [identities.db.insertInto("loginCreations").values({ id, creatorLoginId: login.loginId,
      createdLoginId: login.loginId, organizationId: null, kind: null, details: "{}", createdAt: new Date().toISOString(), completedAt: null }).compile(),
      identities.db.updateTable("user").set({ loginCreationId: id }).where("id", "=", login.loginId).compile()]);
    const before = await readHubState();
    expect((await completeFirstSignIn({ username: makeUsername(), isUsernameConfirmed: true }, await prepareRequest(login))).toJSON())
      .toEqual(err({ code: "core_creation_incomplete" }).toJSON());
    expect(await readHubState()).toEqual(before);
  });

  it.each(["loginId", "email", "role", "isMaster", "loginCreationId"])("when a direct call supplies the server-owned field %s then it is refused without touching anyone", async (field) => {
    const login = await prepareSubject({ username: null });
    const before = await readHubState();
    expect((await completeFirstSignIn({ username: makeUsername(), isUsernameConfirmed: true, [field]: "untrusted" }, await prepareRequest(login))).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: [] }).toJSON());
    expect(await readHubState()).toEqual(before);
  });

  it("when the browser calls the unused native update route then it cannot bypass completion or confirmation", async () => {
    const login = await prepareSubject({ username: null });
    const before = await readHubState();
    const response = await identities.auth.handler(new Request(`${origin}/api/auth/update-user`, { method: "POST",
      headers: { origin, cookie: login.cookie, "content-type": "application/json" }, body: JSON.stringify({ username: makeUsername() }) }));
    expect(response.status).toBe(404);
    expect(await readHubState()).toEqual(before);
  });

  it("when the username audit cannot be saved then the profile remains unchanged and the failure is safe", async () => {
    const login = await prepareSubject({ username: null });
    const context = await prepareRequest(login);
    const before = await readHubState();
    await sql`create trigger test_refuse_username_audit before insert on audit_entries
      when new.action = 'accounts_username_set' begin select raise(abort, 'test_audit_failure'); end`.execute(identities.db.withoutPlugins());
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await completeFirstSignIn({ username: makeUsername(), isUsernameConfirmed: true }, context)).toJSON())
      .toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expect(await readHubState()).toEqual(before);
    expect(log).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: "core_unexpected_error", requestId: context.context.requestId, app: "hub", operation: "accounts_complete_first_sign_in" }));
  });

  it("when a login repairs the casing and spaces in its own invalid initial username then its existing claim is retained", async () => {
    const login = await prepareSubject({ username: null });
    await saveHub(env.DB, [identities.db.withoutPlugins().updateTable("user").set({ username: " Abcd ", displayUsername: " Abcd " }).where("id", "=", login.loginId).compile()]);
    const before = await readHubState();
    expect((await completeFirstSignIn({ username: "abcd", isUsernameConfirmed: true }, await prepareRequest(login))).toJSON())
      .toEqual(ok({ loginId: login.loginId }).toJSON());
    await expectSaved({ login, before, profile: { ...getProfileFrom(before, login.loginId), username: "abcd" } });
  });

  it("when completion includes different valid name and phone values then existing valid details are preserved", async () => {
    const login = await prepareSubject({ username: null });
    const before = await readHubState();
    expect((await completeFirstSignIn({ username: "abcd", isUsernameConfirmed: true, name: "Different person",
      phone: { country: "GB", number: "02079460123" } }, await prepareRequest(login))).toJSON()).toEqual(ok({ loginId: login.loginId }).toJSON());
    await expectSaved({ login, before, profile: { ...getProfileFrom(before, login.loginId), username: "abcd" } });
  });

  it("when profile and audit writes are prepared then both guarded writes find their records by existing indexes", async () => {
    const login = await prepareSubject({ username: null });
    const before = { id: login.loginId, ...await readProfile(login.loginId) };
    const createdAt = new Date().toISOString();
    const queries = firstSignInSaveQueries(identities.db, {
      before, after: { ...before, username: "abcd" }, updatedAt: createdAt,
      audit: { id: crypto.randomUUID(), action: "accounts_username_set", outcome: "success",
        actorLoginId: login.loginId, affectedLoginId: login.loginId, reason: null, comment: null,
        requestId: createRequestContext().requestId, createdAt },
    });
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      const plan = await identities.db.withoutPlugins().executeQuery<{ detail: string }>(
        CompiledQuery.raw(`explain query plan ${query.sql}`, [...query.parameters]),
      );
      const details = plan.rows.map((row) => row.detail);
      expect(details.filter((detail) => /\bSCAN\b/.test(detail) && detail !== "SCAN CONSTANT ROW")).toEqual([]);
      expect(details.some((detail) => detail.startsWith("SEARCH user ") && detail.includes("INDEX"))).toBe(true);
    }
  });

  it("when a valid assigned username is also reserved then missing contact details can still be completed without assigning it again", async () => {
    const login = await prepareSubject({ username: "abcd", phone: null });
    await saveHub(env.DB, [identities.db.insertInto("reservedUsernames").values({
      id: crypto.randomUUID(), username: "abcd", addedAt: new Date().toISOString(),
    }).compile()]);
    const before = await readHubState();
    expect((await completeFirstSignIn({ phone: { country: "US", number: "2025550123" } }, await prepareRequest(login))).toJSON())
      .toEqual(ok({ loginId: login.loginId }).toJSON());
    await expectSaved({ login, before, profile: { ...getProfileFrom(before, login.loginId), phone: "+12025550123" } });
  });

  it("when a legacy spelling belongs to the current login but its normalized name is reserved then repair is refused", async () => {
    const login = await prepareSubject({ username: null });
    await saveHub(env.DB, [
      identities.db.updateTable("user").set({ username: " Abcd " }).where("id", "=", login.loginId).compile(),
      identities.db.insertInto("reservedUsernames").values({ id: crypto.randomUUID(), username: "abcd", addedAt: new Date().toISOString() }).compile(),
    ]);
    const before = await readHubState();
    expect((await completeFirstSignIn({ username: "abcd", isUsernameConfirmed: true }, await prepareRequest(login))).toJSON())
      .toEqual(err({ code: "accounts_username_reserved" }).toJSON());
    expect(await readHubState()).toEqual(before);
  });
});

function validInput() {
  return { username: makeUsername(), name: "Completed person", phone: { country: "US" as const, number: "(202) 555-0123" }, isUsernameConfirmed: true };
}

function makeUsername(): string { return `u${crypto.randomUUID().replaceAll("-", "").slice(0, 7)}`; }

async function prepareSubject(input: Parameters<HubIdentities["signIn"]>[0] = {}): Promise<SignedInLogin> {
  await prepareOtherWorkspace();
  return input.role === "admin" ? await createEnrolledMaster(mfa, input) : await identities.signIn(input);
}

async function prepareOtherWorkspace(): Promise<void> {
  const other = await identities.signIn();
  const workspace = await identities.auth.api.createOrganization({ body: { name: "Unrelated workspace", slug: `story1-${crypto.randomUUID()}`, userId: other.loginId } });
  if (!workspace) throw new Error("The native API did not create the unrelated workspace.");
}

async function prepareRequest(login: SignedInLogin | null): Promise<FirstSignInContext> {
  const context = createRequestContext();
  const access = await createAccessRequest({ app: "hub", session: login, workspaceId: null, hub: env.HUB_ACCESS, context });
  return { database: env.DB, access, context };
}

async function readHubState() {
  return {
    users: await identities.db.selectFrom("user").selectAll().orderBy("id").execute(),
    credentials: await identities.db.selectFrom("account").selectAll().orderBy("id").execute(),
    sessions: await identities.db.selectFrom("session").selectAll().orderBy("id").execute(),
    accounts: await identities.db.selectFrom("accounts").selectAll().orderBy("id").execute(),
    workspaces: await identities.db.selectFrom("organization").selectAll().orderBy("id").execute(),
    members: await identities.db.selectFrom("member").selectAll().orderBy("id").execute(),
    reservations: await identities.db.selectFrom("reservedUsernames").selectAll().orderBy("id").execute(),
    creations: await identities.db.selectFrom("loginCreations").selectAll().orderBy("id").execute(),
    auditEntries: await identities.db.selectFrom("auditEntries").selectAll().orderBy("id").execute(),
  };
}

async function readProfile(loginId: string) { return getProfileFrom(await readHubState(), loginId); }

function getProfileFrom(state: Awaited<ReturnType<typeof readHubState>>, loginId: string) {
  const row = state.users.find((user) => user.id === loginId);
  if (!row) throw new Error("The privately created login is missing.");
  return { username: row.username, name: row.name, phone: row.phone };
}

async function expectOnlyNewSession(input: { before: HubState; login: SignedInLogin }): Promise<void> {
  const after = await readHubState();
  expect(input.before.sessions.filter((session) => session.userId === input.login.loginId)).toEqual([]);
  expect(after).toEqual({ ...input.before, sessions: expect.arrayContaining([
    ...input.before.sessions, expect.objectContaining({ id: input.login.hubSessionId, userId: input.login.loginId }),
  ]) });
  expect(after.sessions).toHaveLength(input.before.sessions.length + 1);
}

type HubState = Awaited<ReturnType<typeof readHubState>>;
async function expectSaved(input: { login: CreatedLogin; before: HubState;
  profile: { username: string | null; name: string; phone: string | null }; context?: FirstSignInContext }): Promise<void> {
  const { login, before, profile, context } = input;
  const after = await readHubState();
  const hasNewUsername = profile.username !== getProfileFrom(before, login.loginId).username;
  const newAudit = hasNewUsername ? [{ id: expect.any(String), action: "accounts_username_set", outcome: "success",
    actorLoginId: login.loginId, affectedLoginId: login.loginId, reason: null, comment: null,
    accountId: null, workspaceId: null, details: null,
    requestId: context?.context.requestId ?? expect.any(String), createdAt: expect.any(String) }] : [];
  expect(after).toEqual({ ...before,
    users: before.users.map((user) => user.id === login.loginId ? { ...user, ...profile, nameSearch: profile.name.trim().toLowerCase(),
      ...(hasNewUsername ? { displayUsername: profile.username } : {}), updatedAt: expect.any(String) } : user),
    auditEntries: expect.arrayContaining([...before.auditEntries, ...newAudit]),
  });
  expect(after.auditEntries).toHaveLength(before.auditEntries.length + newAudit.length);
}
