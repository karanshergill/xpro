import { env } from "cloudflare:workers";
import { prepareLoginCreation, readCreatedLogin, type LoginCreation } from "@xpro/accounts/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interruptAfterWrite } from "#test/creation-faults.db";
import { createSignInFixture, hubRequest, readHubState, type SignInFixture } from "#test/sign-in";
import { handleHubAuthRequest } from "#test/sign-in-actions";
import { createHubAuth } from "./auth.server";

const password = "Reference-password123!";
let fixture: SignInFixture;
let creatorId: string;
beforeEach(async () => {
  fixture = await createSignInFixture(env.DB);
  creatorId = (await fixture.identities.createLogin({ role: "admin" })).loginId;
});
afterEach(async () => { vi.restoreAllMocks(); await fixture.identities.db.destroy(); });

describe("Native initial login creation link", () => {
  it("when trusted creation inserts a native user then that first row contains its saved request link and lookup reads only that linked login", async () => {
    const creation = await savedRequest();
    const auth = await scopedAuth(creation);
    const { user } = await auth.api.createUser({ body: nativeInput(creation) });
    const stored = await fixture.identities.db.selectFrom("user").selectAll().where("id", "=", user.id).executeTakeFirstOrThrow();
    expect(stored.loginCreationId).toBe(creation.id);
    expect(user).not.toHaveProperty("loginCreationId");
    expect(await readCreatedLogin(env.DB, creation.id)).toEqual({
      loginId: stored.id, email: stored.email, username: stored.username, name: stored.name, phone: stored.phone,
      role: stored.role, banned: stored.banned, archivedAt: stored.archivedAt,
    });
    expect(await fixture.identities.db.selectFrom("loginCreations").select(["createdLoginId", "completedAt"])
      .where("id", "=", creation.id).executeTakeFirst()).toEqual({ createdLoginId: null, completedAt: null });
  });

  it("when native body data names another request then the trusted saved reference overrides it", async () => {
    const creation = await savedRequest();
    const other = await savedRequest();
    const before = await readHubState(fixture.identities);
    const auth = await scopedAuth(creation);
    const body = nativeInput(creation);
    const { user } = await auth.api.createUser({ body: { ...body, data: { ...body.data, loginCreationId: other.id } } });
    expect((await readCreatedLogin(env.DB, creation.id))?.loginId).toBe(user.id);
    expect(await readCreatedLogin(env.DB, other.id)).toBeNull();
    expect((await readHubState(fixture.identities)).creations).toEqual(before.creations);
  });

  it("when trusted setup has no saved creation setting then body data cannot attach a creation link", async () => {
    const creation = await savedRequest();
    const body = nativeInput(creation);
    const { user } = await fixture.identities.auth.api.createUser({ body: { ...body, data: { ...body.data, loginCreationId: creation.id } } });
    expect((await fixture.identities.db.selectFrom("user").select("loginCreationId").where("id", "=", user.id).executeTakeFirst())?.loginCreationId).toBeNull();
    expect(await readCreatedLogin(env.DB, creation.id)).toBeNull();
  });

  it.each(["email", "username", "name", "phone"] as const)("when native creation supplies a different %s then no login or credential is written", async (field) => {
    const creation = await savedRequest();
    const auth = await scopedAuth(creation);
    const body = nativeInput(creation);
    if (field === "email") body.email = "other-" + body.email;
    if (field === "username") body.data.username = "other12";
    if (field === "name") body.name = "Different person";
    if (field === "phone") body.data.phone = "+442079460123";
    const before = await readHubState(fixture.identities);
    await expect(auth.api.createUser({ body })).rejects.toMatchObject({ statusCode: 409, body: { code: "accounts_creation_conflict" } });
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it.each([{ role: "admin" as const }, { role: ["user" as const, "admin" as const] }])(
    "when scoped native creation asks for role $role then it cannot grant master access", async ({ role }) => {
    const creation = await savedRequest();
    const auth = await scopedAuth(creation);
    const before = await readHubState(fixture.identities);
    await expect(auth.api.createUser({ body: { ...nativeInput(creation), role } }))
      .rejects.toMatchObject({ statusCode: 409, body: { code: "accounts_creation_conflict" } });
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it.each(["linked", "completed"] as const)("when the supplied saved snapshot is already %s then no new login is created", async (state) => {
    const creation = await savedRequest();
    const auth = await scopedAuth({ ...creation, ...(state === "linked"
      ? { createdLoginId: crypto.randomUUID() } : { completedAt: new Date().toISOString() }) });
    const before = await readHubState(fixture.identities);
    await expect(auth.api.createUser({ body: nativeInput(creation) }))
      .rejects.toMatchObject({ statusCode: 409, body: { code: "accounts_creation_conflict" } });
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it("when the reference was never saved then the existing foreign key refuses the initial login insert", async () => {
    const creation = { ...await savedRequest(), id: crypto.randomUUID() };
    const auth = await scopedAuth(creation);
    const before = await readHubState(fixture.identities);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(auth.api.createUser({ body: nativeInput(creation) })).rejects.toThrow(/FOREIGN KEY constraint failed/);
    expect(await readHubState(fixture.identities)).toEqual(before);
  });

  it("when the connection stops after the initial user insert then the saved link survives without a credential or completion", async () => {
    const creation = await savedRequest();
    const before = await readHubState(fixture.identities);
    const database = interruptAfterWrite(env.DB, (query) => query.startsWith('insert into "user" '));
    const auth = await scopedAuth(creation, database);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(auth.api.createUser({ body: nativeInput(creation) })).rejects.toThrow();
    const linked = await readCreatedLogin(env.DB, creation.id);
    expect(linked).toMatchObject({ email: creation.details.email, username: creation.details.username, role: "user" });
    const after = await readHubState(fixture.identities);
    expect(after.users.filter((row) => row.id !== linked?.loginId)).toEqual(before.users);
    expect({ ...after, users: before.users }).toEqual(before);
  });

  it("when two saved requests create users concurrently then their auth instances keep separate initial links", async () => {
    const creations = await Promise.all([savedRequest(), savedRequest()]);
    const records = await Promise.all(creations.map(async (creation) => {
      const auth = await scopedAuth(creation);
      const { user } = await auth.api.createUser({ body: nativeInput(creation) });
      return { creation, user };
    }));
    for (const { creation, user } of records) expect((await readCreatedLogin(env.DB, creation.id))?.loginId).toBe(user.id);
    expect(records[0]?.user.id).not.toBe(records[1]?.user.id);
  });

  it("when the caller later mutates its configuration object then the auth instance keeps the saved snapshot it captured", async () => {
    const creation = await savedRequest();
    const expected = { ...creation, details: { ...creation.details } };
    const auth = await scopedAuth(creation);
    creation.id = crypto.randomUUID();
    creation.details.name = "Changed after configuration";
    const { user } = await auth.api.createUser({ body: nativeInput(expected) });
    expect((await readCreatedLogin(env.DB, expected.id))?.loginId).toBe(user.id);
    expect(await readCreatedLogin(env.DB, creation.id)).toBeNull();
  });

  it("when a complete-profile login is still pending then the preserved native session hook refuses actual credential sign-in", async () => {
    const creation = await savedRequest();
    const auth = await scopedAuth(creation);
    const { user } = await auth.api.createUser({ body: nativeInput(creation) });
    const response = await handleHubAuthRequest(hubRequest("/api/auth/sign-in/email", {
      email: creation.details.email, password,
    }), fixture.settings);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: "core_creation_incomplete", message: "This login is not ready to use yet.",
      requestId: response.headers.get("x-request-id") });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await fixture.identities.db.selectFrom("session").selectAll().where("userId", "=", user.id).execute()).toEqual([]);
  });

  it.each(["/admin/create-user", "/sign-up/email"] as const)("when scoped creation is attempted through native HTTP %s then the existing route block still applies", async (path) => {
    const creation = await savedRequest();
    const auth = await scopedAuth(creation);
    const before = await readHubState(fixture.identities);
    expect((await auth.handler(hubRequest("/api/auth" + path, nativeInput(creation)))).status).toBe(404);
    expect(await readHubState(fixture.identities)).toEqual(before);
  });
});

async function savedRequest(): Promise<LoginCreation> {
  const result = await prepareLoginCreation(env.DB, { creationId: crypto.randomUUID(), creatorLoginId: creatorId,
    workspaceId: null, kind: null, details: { email: "reference-" + crypto.randomUUID() + "@example.test",
      username: "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7), name: "Created person", phone: "+12025550123" } });
  if (result.isErr) throw new Error("The valid request must be saved.");
  return result.value;
}

async function scopedAuth(creation: LoginCreation, database: D1Database = env.DB): Promise<Awaited<ReturnType<typeof createHubAuth>>> {
  const auth = await createHubAuth({ ...fixture.settings, database, loginCreation: creation });
  await (await auth.$context).checkSchema?.();
  return auth;
}

function nativeInput(creation: LoginCreation): {
  email: string; name: string; password: string; role: "user"; data: { username: string; phone: string };
} {
  return { email: creation.details.email, name: creation.details.name, password, role: "user",
    data: { username: creation.details.username, phone: creation.details.phone } };
}
