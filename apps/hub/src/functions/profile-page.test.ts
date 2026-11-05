import { env } from "cloudflare:workers";
import { pageLoginIdHeader } from "@xpro/core";
import { saveHub } from "@xpro/core/server";
import { maximumPictureBytes, pausedPicturePolicy } from "@xpro/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnProfileFixture, readOwnProfileState, type OwnProfileFixture } from "#test/own-profile";
import { handleProfilePage, validateProfilePage } from "./profile-page.server";
import { handleReadPicture } from "./picture-read.server";
import { handleUpdateProfile, handleChangePassword } from "./profile.server";
import { handleRemovePicture, handleUploadPicture } from "./picture.server";

const origin = "https://hub.example.test";
let fixture: OwnProfileFixture;
let policyCalls: Parameters<Flagship["getObjectValue"]>[];
const standardFlags: Pick<Flagship, "getObjectValue"> = {
  async getObjectValue<T extends object>(key: string, fallback: T, targeting?: FlagshipEvaluationContext): Promise<T> {
    policyCalls.push([key, fallback, targeting]);
    return { canUpload: true, maximumBytes: maximumPictureBytes } as T;
  },
};
beforeEach(async () => { fixture = await createOwnProfileFixture(); policyCalls = []; });
afterEach(async () => { await fixture.signIn.identities.db.destroy(); vi.restoreAllMocks(); });

describe("Own-profile page read", () => {
  it.each(["regular", "master"])("when an active %s opens the page then only their editable profile and read-only identifiers are disclosed", async (kind) => {
    if (kind === "master") fixture.person = await fixture.signIn.signInMaster();
    const before = await readOwnProfileState(fixture);
    const own = before.hub.users.find((row) => row.id === fixture.person.loginId);
    const response = await readPage();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ loginId: fixture.person.loginId, email: own?.email, username: own?.username, name: own?.name, phone: own?.phone, pictureRevision: null, mfa: kind === "master" ? "ready" : "unavailable",
      picturePolicy: { canUpload: true, maximumBytes: maximumPictureBytes } });
    expect(policyCalls).toEqual([["accounts_picture_policy", pausedPicturePolicy, { targetingKey: fixture.person.loginId }]]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readOwnProfileState(fixture)).toEqual(before);
  });

  it.each(["anonymous", "ended", "inactive", "incomplete", "changed identity"])("when access is %s then no private profile fields are disclosed", async (state) => {
    if (state === "ended") await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: fixture.person.cookie } });
    if (state === "inactive" || state === "incomplete") await saveHub(env.DB, [fixture.signIn.identities.db.updateTable("user")
      .set(state === "inactive" ? { banned: 1 } : { phone: null }).where("id", "=", fixture.person.loginId).compile()]);
    const before = await readOwnProfileState(fixture);
    const response = await readPage({ headers: state === "anonymous" ? { cookie: "" }
      : state === "changed identity" ? { [pageLoginIdHeader]: fixture.other.loginId } : {} });
    await expectFailure(response, state === "anonymous" || state === "ended" ? "core_unauthenticated"
      : state === "inactive" ? "core_login_inactive" : state === "incomplete" ? "core_profile_incomplete" : "core_identity_changed");
    expect(policyCalls).toEqual([]);
    expect(await readOwnProfileState(fixture)).toEqual(before);
  });

  it.each(["foreign Origin", "missing Origin", "foreign address", "wrong GET path", "HEAD", "extra input"])("when a page read uses %s then the boundary refuses it", async (state) => {
    const request = makeRequest(state === "wrong GET path" ? "/another" : "/profile", {
      method: state === "HEAD" ? "HEAD" : state.includes("Origin") || state === "extra input" ? "POST" : "GET",
      headers: state === "foreign Origin" ? { origin: "https://foreign.test" } : state === "missing Origin" ? { origin: "" } : {},
      origin: state === "foreign address" ? "https://foreign.test" : origin,
    });
    const response = await handleProfilePage(validateProfilePage(state === "extra input" ? { loginId: fixture.other.loginId } : {}), { request, settings: fixture.signIn.settings, flags: standardFlags });
    await expectFailure(response, state === "extra input" ? "core_invalid_input" : "core_forbidden");
    expect(policyCalls).toEqual([]);
  });
});

describe("Private profile picture controls", () => {
  it.each(["standard", "paused", "reduced", "absent binding", "native missing flag", "malformed", "provider failure"] as const)(
    "when the upload policy is %s then GET and POST profile reads remain available and disclose only effective controls", async (state) => {
      const before = await readOwnProfileState(fixture), own = before.hub.users.find((row) => row.id === fixture.person.loginId);
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const calls: Parameters<Flagship["getObjectValue"]>[] = [];
      const policy = state === "standard" ? { canUpload: true, maximumBytes: maximumPictureBytes }
        : state === "reduced" ? { canUpload: true, maximumBytes: 1_048_576 } : pausedPicturePolicy;
      const flags: Pick<Flagship, "getObjectValue"> = {
        async getObjectValue<T extends object>(key: string, fallback: T, targeting?: FlagshipEvaluationContext): Promise<T> {
          calls.push([key, fallback, targeting]);
          if (state === "provider failure") throw new Error("private-provider-text");
          return { ...policy, ...(state === "malformed" ? { maximumBytes: maximumPictureBytes + 1 } : {}), privateRule: "private" } as T;
        },
      };
      for (const method of ["GET", "POST"]) {
        calls.length = 0; log.mockClear();
        const response = await handleProfilePage(validateProfilePage({}), { request: makeRequest("/profile", { method }), settings: fixture.signIn.settings,
          ...(state === "absent binding" ? {} : { flags: state === "native missing flag" ? env.FLAGS : flags }) });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ loginId: fixture.person.loginId, email: own?.email, username: own?.username, name: own?.name, phone: own?.phone,
          pictureRevision: null, mfa: "unavailable", picturePolicy: policy });
        expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.getSetCookie()).toEqual([]);
        expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
        expect(calls).toEqual(state === "absent binding" || state === "native missing flag" ? [] : [["accounts_picture_policy", pausedPicturePolicy,
          { targetingKey: fixture.person.loginId }]]);
        expect(log.mock.calls).toEqual(state === "malformed" || state === "provider failure" ? [[JSON.stringify({ event: "core_unexpected_error",
          requestId: response.headers.get("x-request-id"), app: "hub", operation: "accounts_picture_policy" })]] : []);
      }
      expect(await readOwnProfileState(fixture)).toEqual(before);
    },
  );

  it.each(["archived", "master without MFA"])("when page access is %s then policy evaluation cannot precede the refusal", async (state) => {
    if (state === "master without MFA") fixture.person = await fixture.signIn.identities.signIn({ role: "admin" });
    else await saveHub(env.DB, [fixture.signIn.identities.db.updateTable("user").set({ archivedAt: new Date().toISOString() }).where("id", "=", fixture.person.loginId).compile()]);
    const before = await readOwnProfileState(fixture);
    await expectFailure(await readPage(), state === "archived" ? "core_login_inactive" : "core_mfa_required");
    expect(policyCalls).toEqual([]); expect(await readOwnProfileState(fixture)).toEqual(before);
  });
});

describe("Private own-picture read", () => {
  it.each(["GET", "HEAD"])("when the current owned revision is read using %s then it is a private PNG and the key stays private", async (method) => {
    const revision = await storePicture();
    const response = await readPicture(revision, { method });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("cookie");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(method === "HEAD" ? new Uint8Array() : new Uint8Array([1, 2, 3]));
  });

  it.each(["other revision", "other actor", "removed", "missing R2 object"])("when a saved URL is %s then it cannot disclose an old or different person's picture", async (state) => {
    const revision = await storePicture();
    if (state === "removed") await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.person.loginId, { pictureKey: null });
    if (state === "missing R2 object") await env.PROFILE_PICTURES.delete("profiles/" + fixture.person.loginId + "/" + revision + ".png");
    const response = await readPicture(state === "other revision" ? crypto.randomUUID() : revision, { headers: state === "other actor" ? { cookie: fixture.other.cookie } : {} });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "accounts_picture_not_found", message: "This picture could not be found.", requestId: response.headers.get("x-request-id") });
  });

  it.each(["../secret", "not-a-uuid", "profiles/key", "00000000-0000-4000-8000-000000000001?key=private"])("when the picture selector is %s then it cannot become a caller-selected storage key", async (revision) => {
    await expectFailure(await readPicture(revision), "core_invalid_input");
  });

  it.each(["anonymous", "ended", "inactive", "identity changed", "POST", "foreign address"])("when a picture request is %s then it must pass fresh own-profile authorization", async (state) => {
    const revision = await storePicture();
    if (state === "ended") await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: fixture.person.cookie } });
    if (state === "inactive") await saveHub(env.DB, [fixture.signIn.identities.db.updateTable("user").set({ banned: 1 }).where("id", "=", fixture.person.loginId).compile()]);
    const response = await readPicture(revision, { method: state === "POST" ? "POST" : "GET",
      origin: state === "foreign address" ? "https://foreign.test" : origin,
      headers: state === "anonymous" ? { cookie: "" } : state === "identity changed" ? { [pageLoginIdHeader]: fixture.other.loginId } : {} });
    await expectFailure(response, state === "anonymous" || state === "ended" ? "core_unauthenticated" : state === "inactive" ? "core_login_inactive"
      : state === "identity changed" ? "core_identity_changed" : "core_forbidden");
  });

  it("when storage points outside the actor's directory then both page and image reads fail safely", async () => {
    const revision = crypto.randomUUID();
    await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.person.loginId, { pictureKey: "profiles/" + fixture.other.loginId + "/" + revision + ".png" });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expectFailure(await readPage(), "core_unexpected_error");
    await expectFailure(await readPicture(revision), "core_unexpected_error");
    expect(log.mock.calls).toHaveLength(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain(fixture.other.loginId);
  });
});

describe("Original profile page actor", () => {
  it.each(["details", "password", "upload", "remove"])("when the browser signs in as someone else then %s cannot write using the previous page", async (action) => {
    const before = await readOwnProfileState(fixture), headers = { [pageLoginIdHeader]: fixture.other.loginId };
    let response: Response;
    const services = { request: makeRequest("/_serverFn/profile", { method: "POST", headers }), settings: fixture.signIn.settings };
    if (action === "details") response = await handleUpdateProfile({ name: "Changed", phone: { country: "GB", number: "2079460018" } }, services);
    else if (action === "password") response = await handleChangePassword({ currentPassword: "Access-fixture123!", newPassword: "Different-password123!" }, services);
    else if (action === "remove") response = await handleRemovePicture({}, { ...services, pictures: env.PROFILE_PICTURES });
    else {
      const form = new FormData(); form.set("file", new File(["invalid"], "picture.png"));
      response = await handleUploadPicture({ ...services, request: new Request(origin + "/api/v1/profile-pictures", {
        method: "POST", headers: { cookie: fixture.person.cookie, origin, ...headers }, body: form }), pictures: env.PROFILE_PICTURES, images: env.IMAGES });
    }
    await expectFailure(response, "core_identity_changed"); expect(await readOwnProfileState(fixture)).toEqual(before);
  });
});

function makeRequest(path: string, options: { headers?: HeadersInit; origin?: string; method?: string } = {}): Request {
  const headers = new Headers({ cookie: fixture.person.cookie, origin });
  for (const [key, value] of new Headers(options.headers)) headers.set(key, value);
  return new Request((options.origin ?? origin) + path, { method: options.method ?? "GET", headers });
}
async function readPage(options: { headers?: HeadersInit } = {}): Promise<Response> {
  return await handleProfilePage(validateProfilePage({}), { request: makeRequest("/profile", options), settings: fixture.signIn.settings, flags: standardFlags });
}
async function readPicture(revision: string, options: { headers?: HeadersInit; origin?: string; method?: string } = {}): Promise<Response> {
  return await handleReadPicture({ request: makeRequest("/api/v1/profile-pictures/" + revision, options), settings: fixture.signIn.settings, pictures: env.PROFILE_PICTURES });
}
async function storePicture(): Promise<string> {
  const revision = crypto.randomUUID(), key = "profiles/" + fixture.person.loginId + "/" + revision + ".png";
  await env.PROFILE_PICTURES.put(key, new Uint8Array([1, 2, 3]), { httpMetadata: { contentType: "image/png" } });
  await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.person.loginId, { pictureKey: key });
  return revision;
}
async function expectFailure(response: Response, code: string): Promise<void> {
  expect(response.ok).toBe(false);
  const body = await response.json();
  expect(body).toMatchObject({ code, requestId: response.headers.get("x-request-id") });
  expect(Object.keys(body as object).sort()).toEqual(["code", "message", "requestId", ...(code === "core_invalid_input" || code === "core_profile_incomplete" ? ["fields"] : [])].sort());
  expect(response.headers.get("set-cookie")).toBeNull();
}
