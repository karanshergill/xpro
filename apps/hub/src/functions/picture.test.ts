import { env } from "cloudflare:workers";
import { sql } from "kysely";
import { pageLoginIdHeader } from "@xpro/core";
import { saveHub } from "@xpro/core/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignedInLogin } from "#test/hub-identities";
import { createOwnProfileFixture, readOwnProfileState, readPictures, seedPicture, type OwnProfileFixture } from "#test/own-profile";
import { pictureFile, squarePicture } from "#test/picture-fixtures";
import { handleRemovePicture, handleUploadPicture } from "./picture.server";

let fixture: OwnProfileFixture;
let previousKey: string;
let policyCalls: Parameters<Flagship["getObjectValue"]>[];
// Only the outside Flagship boundary supplies standard values for these handler checks.
const standardFlags: Pick<Flagship, "getObjectValue"> = {
  async getObjectValue<T extends object>(key: string, fallback: T, targeting?: FlagshipEvaluationContext): Promise<T> {
    policyCalls.push([key, fallback, targeting]);
    return { canUpload: true, maximumBytes: 2 * 1024 * 1024 } as T;
  },
};
beforeEach(async () => {
  policyCalls = [];
  fixture = await createOwnProfileFixture();
  previousKey = await seedPicture({ fixture, login: fixture.person, file: squarePicture() });
  await seedPicture({ fixture, login: fixture.other, file: squarePicture() });
});
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("authenticated Hub picture uploads", () => {
  it("when a person uploads real JPEG data then only their login ID is returned and a cleaned square replaces the old object", async () => {
    const before = await readOwnProfileState(fixture), objects = await readPictures();
    const file = new File([await pictureFile("jpeg").arrayBuffer()], "../../private-person.html", { type: "text/html" });
    const response = await upload(form(file), { headers: { "x-request-id": "untrusted-request-id" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ loginId: fixture.person.loginId });
    expect(policyCalls).toEqual([["accounts_picture_policy", { canUpload: false, maximumBytes: 2 * 1024 * 1024 },
      { targetingKey: fixture.person.loginId }]]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const after = await readOwnProfileState(fixture);
    const key = after.hub.users.find((row) => row.id === fixture.person.loginId)?.pictureKey;
    if (!key) throw new Error("The uploaded picture must keep its generated key.");
    expect(key).not.toMatch(/private-person|html|\.\./);
    const saved = await env.PROFILE_PICTURES.get(key);
    if (!saved) throw new Error("The generated picture must be in real R2 storage.");
    const bytes = new Uint8Array(await saved.arrayBuffer());
    expect(saved.httpMetadata?.contentType).toBe("image/png");
    expect(new DataView(bytes.buffer).getUint32(16)).toBe(2);
    expect(new DataView(bytes.buffer).getUint32(20)).toBe(2);
    expect(new TextDecoder().decode(bytes)).not.toContain("private-camera-marker");
    expect((await readPictures()).map((object) => object.key).sort()).toEqual([...objects.filter((object) => object.key !== previousKey).map((object) => object.key), key].sort());
    expect(after.hub.users.filter((row) => row.id !== fixture.person.loginId)).toEqual(before.hub.users.filter((row) => row.id !== fixture.person.loginId));
    expect({ ...after, hub: { ...after.hub, users: before.hub.users } }).toEqual(before);
  });

  it.each(["anonymous", "tampered cookie", "ended session"] as const)(
    "when upload identity is %s then claimed authority grants no write", async (state) => {
      if (state === "ended session") await fixture.signIn.identities.auth.api.signOut({ headers: { cookie: fixture.person.cookie } });
      const before = await readOwnProfileState(fixture), objects = await readPictures();
      const response = await upload(form(), { actor: state === "anonymous" ? null : fixture.person,
        headers: { "x-login-id": fixture.other.loginId, "x-is-master": "true",
          ...(state === "tampered cookie" ? { cookie: fixture.person.cookie + "tampered" } : {}) } });
      await expectFailure(response, { status: 401, code: "core_unauthenticated", message: "Sign in to continue." });
      expect(policyCalls).toEqual([]);
      expect(await readOwnProfileState(fixture)).toEqual(before);
      expect(await readPictures()).toEqual(objects);
    },
  );

  it.each(["GET", "foreign Origin", "missing Origin"] as const)(
    "when upload uses %s then the POST boundary refuses it", async (state) => {
      const before = await readOwnProfileState(fixture), objects = await readPictures();
      const response = await upload(form(), {
        ...(state === "GET" ? { method: "GET" } : {}),
        ...(state === "foreign Origin" ? { headers: { origin: "https://foreign.invalid" } } : {}),
        ...(state === "missing Origin" ? { shouldOmitOrigin: true } : {}),
      });
      await expectFailure(response, { status: 403, code: "core_forbidden", message: "You do not have permission to do this." });
      expect(policyCalls).toEqual([]);
      expect(await readOwnProfileState(fixture)).toEqual(before);
      expect(await readPictures()).toEqual(objects);
    },
  );

  it.each(["empty", "text file field", "duplicate file", "server-owned field", "malformed boundary"] as const)(
    "when multipart input has %s then it returns safe field errors without saving", async (state) => {
      const body = state === "empty" ? new FormData() : form();
      if (state === "text file field") body.set("file", "https://private.invalid/photo");
      if (state === "duplicate file") body.append("file", pictureFile("png"));
      if (state === "server-owned field") body.set("loginId", fixture.other.loginId);
      const before = await readOwnProfileState(fixture), objects = await readPictures();
      await expectFailure(await upload(state === "malformed boundary" ? "not-a-multipart-body" : body, state === "malformed boundary"
        ? { headers: { "content-type": "multipart/form-data; boundary=missing" } } : {}), {
        status: 400, code: "core_invalid_input", message: "Check the submitted details.",
        fields: state === "server-owned field" ? [] : ["file"],
      });
      expect(await readOwnProfileState(fixture)).toEqual(before);
      expect(await readPictures()).toEqual(objects);
    },
  );

  it("when the upload encoding is JSON then it is refused as an unsupported request type", async () => {
    const before = await readOwnProfileState(fixture);
    await expectFailure(await upload("{}", { headers: { "content-type": "application/json" } }), {
      status: 415, code: "core_unsupported_media_type", message: "Use the content type supported by this endpoint.",
    });
    expect(await readOwnProfileState(fixture)).toEqual(before);
  });

  it.each([2 * 1024 * 1024, 2 * 1024 * 1024 + 1])(
    "when a real JPEG payload contains %s bytes then the inclusive per-file limit is enforced", async (size) => {
      const bytes = new Uint8Array(size); bytes.set(new Uint8Array(await pictureFile("jpeg").arrayBuffer()));
      const before = await readOwnProfileState(fixture), objects = await readPictures();
      const response = await upload(form(new File([bytes], "padded.jpg", { type: "image/jpeg" })));
      if (size === 2 * 1024 * 1024) {
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ loginId: fixture.person.loginId });
      } else {
        await expectFailure(response, { status: 413, code: "accounts_picture_too_large", message: "Use a picture within the current upload limit." });
        expect(await readOwnProfileState(fixture)).toEqual(before);
        expect(await readPictures()).toEqual(objects);
      }
    },
  );

  it("when streamed bytes exceed the multipart cap despite a small Content-Length then the reader cuts them off without saving", async () => {
    const before = await readOwnProfileState(fixture), objects = await readPictures();
    await expectFailure(await upload("x".repeat(2 * 1024 * 1024 + 64 * 1024 + 1), {
      headers: { "content-type": "multipart/form-data; boundary=test", "content-length": "1" },
    }), { status: 413, code: "core_request_too_large", message: "The request is too large." });
    expect(await readOwnProfileState(fixture)).toEqual(before);
    expect(await readPictures()).toEqual(objects);
  });

  it("when the local image decoder fails without a code then HTTP returns one safe error and preserves the old picture", async () => {
    const before = await readOwnProfileState(fixture), objects = await readPictures();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await upload(form(new File([new Uint8Array([0xff, 0xd8, 0xff, 0, 0])], "private-corrupt.jpg")));
    await expectFailure(response, { status: 500, code: "core_unexpected_error", message: "Something went wrong. Please try again." });
    expect(await readOwnProfileState(fixture)).toEqual(before);
    expect(await readPictures()).toEqual(objects);
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "accounts_upload_picture" })]]);
  });

  it("when saving the picture key fails then HTTP exposes no native error and removes the unreferenced new object", async () => {
    await sql`create trigger test_refuse_http_picture before update of picture_key on user
      begin select raise(abort, 'private_http_picture_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
    const before = await readOwnProfileState(fixture), objects = await readPictures();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await upload(form());
    await expectFailure(response, { status: 500, code: "core_unexpected_error", message: "Something went wrong. Please try again." });
    expect(await readOwnProfileState(fixture)).toEqual(before);
    expect(await readPictures()).toEqual(objects);
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "accounts_upload_picture" })]]);
  });

  it("when the person removes a picture then the JSON POST returns only their ID and clears only that picture", async () => {
    const request = new Request("https://hub.example.test/_serverFn/remove-picture", { method: "POST", headers: {
      origin: "https://hub.example.test", cookie: fixture.person.cookie, "content-type": "application/json",
    }, body: "{}" });
    const response = await handleRemovePicture({}, { request, pictures: env.PROFILE_PICTURES, settings: fixture.signIn.settings });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ loginId: fixture.person.loginId });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await readOwnProfileState(fixture)).hub.users.find((row) => row.id === fixture.person.loginId)?.pictureKey).toBeNull();
    expect((await readPictures()).map((object) => object.key)).not.toContain(previousKey);
    expect(await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: fixture.person.cookie }, query: { disableCookieCache: true } })).not.toBeNull();
  });
});

describe("Hub picture upload policy enforcement", () => {
  it.each(["paused", "absent binding", "native missing flag", "malformed", "provider failure"] as const)(
    "when the policy is %s then a direct upload is refused before consuming its body or touching Images/R2", async (state) => {
      const before = await readOwnProfileState(fixture), objects = await readPictures();
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      let bodyReads = 0, outsideTouches = 0;
      const body = new ReadableStream<Uint8Array>({ pull(controller) { bodyReads++; controller.close(); } }, { highWaterMark: 0 });
      const request = new Request("https://hub.example.test/api/v1/profile-pictures", { method: "POST", body, headers: {
        origin: "https://hub.example.test", cookie: fixture.person.cookie, [pageLoginIdHeader]: fixture.person.loginId,
        "content-type": "multipart/form-data; boundary=unused", "x-can-upload": "true", "x-maximum-bytes": "999999999",
      } });
      const pictures = new Proxy(env.PROFILE_PICTURES, { get() { outsideTouches++; throw new Error("Unexpected R2 access."); } });
      const images = new Proxy(env.IMAGES, { get() { outsideTouches++; throw new Error("Unexpected Images access."); } });
      const calls: Parameters<Flagship["getObjectValue"]>[] = [];
      const controlled: Pick<Flagship, "getObjectValue"> = {
        async getObjectValue<T extends object>(key: string, fallback: T, targeting?: FlagshipEvaluationContext): Promise<T> {
          calls.push([key, fallback, targeting]);
          if (state === "provider failure") throw new Error("private-provider-failure");
          return { canUpload: state === "malformed", maximumBytes: state === "malformed" ? 999999999 : 2 * 1024 * 1024 } as T;
        },
      };
      const flags = state === "native missing flag" ? env.FLAGS : controlled;
      try {
        const response = await handleUploadPicture({ request, pictures, images, settings: fixture.signIn.settings,
          ...(state === "absent binding" ? {} : { flags }) });
        await expectFailure(response, { status: 503, code: "accounts_picture_uploads_unavailable",
          message: "Picture uploads are temporarily unavailable. You can still remove your current picture." });
        expect({ bodyReads, outsideTouches, bodyUsed: request.bodyUsed }).toEqual({ bodyReads: 0, outsideTouches: 0, bodyUsed: false });
        expect(calls).toEqual(state === "native missing flag" || state === "absent binding" ? [] : [
          ["accounts_picture_policy", { canUpload: false, maximumBytes: 2 * 1024 * 1024 }, { targetingKey: fixture.person.loginId }],
        ]);
        expect(log.mock.calls).toEqual(state === "malformed" || state === "provider failure" ? [[JSON.stringify({
          event: "core_unexpected_error", requestId: response.headers.get("x-request-id"), app: "hub", operation: "accounts_picture_policy",
        })]] : []);
        expect(await readOwnProfileState(fixture)).toEqual(before);
        expect(await readPictures()).toEqual(objects);
      } finally { await request.body?.cancel(); }
    },
  );

  it.each([1_048_576, 1_048_577])("when a direct upload sends %s bytes under a reduced policy then the current file limit is enforced", async (size) => {
    const bytes = new Uint8Array(size); bytes.set(new Uint8Array(await pictureFile("jpeg").arrayBuffer()));
    const before = await readOwnProfileState(fixture), objects = await readPictures();
    const flags: Pick<Flagship, "getObjectValue"> = {
      async getObjectValue<T extends object>(): Promise<T> { return { canUpload: true, maximumBytes: 1_048_576 } as T; },
    };
    const response = await upload(form(new File([bytes], "portrait.jpg", { type: "image/jpeg" })), { flags });
    if (size === 1_048_576) {
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ loginId: fixture.person.loginId });
    } else {
      await expectFailure(response, { status: 413, code: "accounts_picture_too_large", message: "Use a picture within the current upload limit." });
      expect(await readOwnProfileState(fixture)).toEqual(before);
      expect(await readPictures()).toEqual(objects);
    }
  });

  it.each(["suspended", "archived", "incomplete", "changed identity", "master without MFA"] as const)(
    "when access is %s then even a permissive policy is not evaluated", async (state) => {
      const actor = state === "master without MFA" ? await fixture.signIn.identities.signIn({ role: "admin" })
        : state === "incomplete" ? await fixture.signIn.identities.signIn({ phone: null }) : fixture.person;
      if (state === "suspended" || state === "archived") await saveHub(env.DB, [fixture.signIn.identities.db.updateTable("user")
        .set(state === "suspended" ? { banned: 1 } : { archivedAt: new Date().toISOString() }).where("id", "=", actor.loginId).compile()]);
      const before = await readOwnProfileState(fixture), objects = await readPictures();
      const response = await upload(form(), { actor, ...(state === "changed identity" ? { headers: { [pageLoginIdHeader]: fixture.other.loginId } } : {}) });
      const expected = state === "changed identity" ? { status: 409, code: "core_identity_changed", message: "Your sign-in has changed. Reload this page to continue." }
        : state === "incomplete" ? { status: 403, code: "core_profile_incomplete", message: "Complete the required profile details.", fields: ["phone"] }
        : state === "master without MFA" ? { status: 403, code: "core_mfa_required", message: "Complete multi-factor authentication to continue." }
        : { status: 403, code: "core_login_inactive", message: "This login is not active." };
      await expectFailure(response, expected);
      expect(policyCalls).toEqual([]);
      expect(await readOwnProfileState(fixture)).toEqual(before);
      expect(await readPictures()).toEqual(objects);
    },
  );
});

function form(file: File = pictureFile("png")): FormData { const value = new FormData(); value.set("file", file); return value; }

async function upload(body: BodyInit, options: {
  actor?: SignedInLogin | null; headers?: HeadersInit; method?: string; shouldOmitOrigin?: boolean; flags?: Pick<Flagship, "getObjectValue">;
} = {}): Promise<Response> {
  const actor = options.actor === undefined ? fixture.person : options.actor;
  const headers = new Headers({ origin: "https://hub.example.test", ...(actor ? { cookie: actor.cookie } : {}) });
  for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
  if (options.shouldOmitOrigin) headers.delete("origin");
  const method = options.method ?? "POST";
  return await handleUploadPicture({ request: new Request("https://hub.example.test/api/v1/profile-pictures", {
    method, headers, ...(method === "GET" ? {} : { body }),
  }), settings: fixture.signIn.settings, pictures: env.PROFILE_PICTURES, images: env.IMAGES, flags: options.flags ?? standardFlags });
}

async function expectFailure(response: Response, expected: { status: number; code: string; message: string; fields?: string[] }): Promise<void> {
  const { status, ...body } = expected;
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  expect(await response.json()).toEqual({ ...body, requestId: response.headers.get("x-request-id") });
}
