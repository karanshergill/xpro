import { env } from "cloudflare:workers";
import type { PictureError } from "@xpro/accounts/server";
import { sql } from "kysely";
import { err, ok, type Result } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnProfileFixture, prepareProfileServices, readOwnProfileState, readPictures, seedPicture,
  type OwnProfileFixture, type PictureServices } from "#test/own-profile";
import { pictureFile, squarePicture } from "#test/picture-fixtures";
import { uploadPicture as upload, removePicture as remove } from "./picture.server";

type PictureAction = (input: unknown, services: PictureServices) => Promise<Result<{ loginId: string }, PictureError>>;
const uploadPicture: PictureAction = upload;
const removePicture: PictureAction = remove;
const maximumPictureBytes = 2 * 1024 * 1024;
let fixture: OwnProfileFixture;
let previousKey: string;
beforeEach(async () => {
  fixture = await createOwnProfileFixture();
  previousKey = await seedPicture({ fixture, login: fixture.person, file: squarePicture() });
  await seedPicture({ fixture, login: fixture.other, file: squarePicture() });
});
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("Story 4 — own picture", () => {
  it.each(["jpeg", "png", "webp"] as const)(
    "when a person uploads a supported %s picture then the processed square replaces only their own picture", async (format) => {
      const file = pictureFile(format);
      const cleaned = squarePicture();
      // Only the external byte-processing service is a stand-in; D1 and R2 are real.
      const processPicture = vi.fn(async (_file: File) => ok<Blob, never>(cleaned));
      const before = await readOwnProfileState(fixture), pictures = await readPictures();
      const services = { ...await preparePictureServices(), processPicture };
      expect((await uploadPicture({ file }, services)).toJSON()).toEqual(ok({ loginId: fixture.person.loginId }).toJSON());
      const after = await readOwnProfileState(fixture);
      const person = after.hub.users.find((user) => user.id === fixture.person.loginId);
      const key = person?.pictureKey;
      if (!key) throw new Error("A successful upload must save its generated picture key.");
      expect(key).not.toBe(previousKey);
      expect(key).not.toContain(file.name);
      expect(processPicture).toHaveBeenCalledTimes(1);
      const submitted = processPicture.mock.calls[0]?.[0];
      expect(submitted ? new Uint8Array(await submitted.arrayBuffer()) : null).toEqual(new Uint8Array(await file.arrayBuffer()));
      expect(await readPictures()).toEqual([
        ...pictures.filter((object) => object.key !== previousKey),
        { key, contentType: cleaned.type, bytes: new Uint8Array(await cleaned.arrayBuffer()) },
      ].sort((left, right) => left.key.localeCompare(right.key)));
      expect(person).toEqual({ ...before.hub.users.find((user) => user.id === fixture.person.loginId),
        pictureKey: key, updatedAt: expect.any(String) });
      expect(after.hub.users.filter((user) => user.id !== fixture.person.loginId)).toEqual(before.hub.users.filter((user) => user.id !== fixture.person.loginId));
      expect({ ...after, hub: { ...after.hub, users: before.hub.users } }).toEqual(before);
    },
  );

  it("when two uploads succeed then each uses a fresh key and no earlier replacement object remains", async () => {
    const before = await readPictures();
    expect((await uploadPicture({ file: pictureFile("png") }, await preparePictureServices())).toJSON()).toEqual(ok({ loginId: fixture.person.loginId }).toJSON());
    const firstKey = (await readOwnProfileState(fixture)).hub.users.find((user) => user.id === fixture.person.loginId)?.pictureKey;
    if (!firstKey) throw new Error("The first upload must save a picture key.");
    expect((await uploadPicture({ file: pictureFile("webp") }, await preparePictureServices())).toJSON()).toEqual(ok({ loginId: fixture.person.loginId }).toJSON());
    const lastKey = (await readOwnProfileState(fixture)).hub.users.find((user) => user.id === fixture.person.loginId)?.pictureKey;
    if (!lastKey) throw new Error("The second upload must save a picture key.");
    expect(lastKey).not.toBe(firstKey);
    expect(await readPictures()).toEqual([
      ...before.filter((object) => object.key !== previousKey),
      { key: lastKey, contentType: squarePicture().type, bytes: new Uint8Array(await squarePicture().arrayBuffer()) },
    ].sort((left, right) => left.key.localeCompare(right.key)));
  });

  it("when valid picture bytes have a misleading MIME type and path-like name then content determines acceptance and the server generates the key", async () => {
    const file = new File([await pictureFile("png").arrayBuffer()], "../../other-person/private.html", { type: "text/html" });
    expect((await uploadPicture({ file }, await preparePictureServices())).toJSON()).toEqual(ok({ loginId: fixture.person.loginId }).toJSON());
    const key = (await readOwnProfileState(fixture)).hub.users.find((user) => user.id === fixture.person.loginId)?.pictureKey;
    expect(key).toEqual(expect.any(String));
    expect(key).not.toMatch(/other-person|private|\.html|\.\./);
  });

  it.each([maximumPictureBytes, maximumPictureBytes + 1])(
    "when actual picture size is %s bytes then the 2 MiB limit includes the boundary", async (size) => {
      const bytes = new Uint8Array(size);
      bytes.set(new Uint8Array(await pictureFile("jpeg").arrayBuffer()));
      const processPicture = vi.fn(async (_file: File) => ok<Blob, never>(squarePicture()));
      const services = { ...await preparePictureServices(), processPicture };
      const before = await readOwnProfileState(fixture), pictures = await readPictures();
      const result = await uploadPicture({ file: new File([bytes], "portrait.jpg", { type: "image/jpeg" }) }, services);
      expect(result.toJSON()).toEqual(size === maximumPictureBytes
        ? ok({ loginId: fixture.person.loginId }).toJSON() : err({ code: "accounts_picture_too_large" }).toJSON());
      if (size > maximumPictureBytes) {
        expect(processPicture).not.toHaveBeenCalled();
        expect(await readOwnProfileState(fixture)).toEqual(before);
        expect(await readPictures()).toEqual(pictures);
      } else expect(processPicture).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { bytes: "<html>not a picture</html>", type: "image/jpeg", code: "accounts_picture_type_invalid" },
    { bytes: "GIF89a-not-a-supported-format", type: "image/png", code: "accounts_picture_type_invalid" },
    { bytes: "<svg xmlns='http://www.w3.org/2000/svg'/>", type: "image/svg+xml", code: "accounts_picture_type_invalid" },
    { bytes: "", type: "image/png", code: "accounts_picture_invalid" },
  ])("when uploaded content is invalid ($code) then the previous picture stays", async ({ bytes, type, code }) => {
    const processPicture = vi.fn(async (_file: File) => ok<Blob, never>(squarePicture()));
    const before = await readOwnProfileState(fixture), pictures = await readPictures();
    expect((await uploadPicture({ file: new File([bytes], "pretend.jpg", { type }) },
      { ...await preparePictureServices(), processPicture })).toJSON()).toEqual(err({ code }).toJSON());
    expect(processPicture).not.toHaveBeenCalled();
    expect(await readOwnProfileState(fixture)).toEqual(before);
    expect(await readPictures()).toEqual(pictures);
  });

  it.each(["loginId", "pictureKey"])("when upload includes the server-owned field %s then no login or object changes", async (field) => {
    const before = await readOwnProfileState(fixture), pictures = await readPictures();
    expect((await uploadPicture({ file: pictureFile("png"), [field]: fixture.other.loginId }, await preparePictureServices())).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: [] }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before);
    expect(await readPictures()).toEqual(pictures);
  });

  it.each(["processing", "object save", "profile save"] as const)(
    "when picture %s fails then the old picture stays and no unreferenced upload remains", async (failure) => {
      const services = await preparePictureServices();
      if (failure === "processing") services.processPicture = async () => { throw new Error("private_processor_failure"); };
      if (failure === "object save") services.pictures = new Proxy(env.PROFILE_PICTURES, {
        get(target, property, receiver) {
          if (property === "put") return async () => { throw new Error("private_bucket_failure"); };
          const value: unknown = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      if (failure === "profile save") await sql`create trigger test_refuse_picture_update before update of picture_key on user
        begin select raise(abort, 'private_picture_database_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const before = await readOwnProfileState(fixture), pictures = await readPictures();
      expect((await uploadPicture({ file: pictureFile("jpeg") }, services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
      expect(await readOwnProfileState(fixture)).toEqual(before);
      expect(await readPictures()).toEqual(pictures);
      expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: services.context.requestId, app: "hub", operation: "accounts_upload_picture" })]]);
    },
  );

  it("when a person removes their picture then their key is cleared and only their old object is removed", async () => {
    const before = await readOwnProfileState(fixture), pictures = await readPictures();
    expect((await removePicture({}, await preparePictureServices())).toJSON()).toEqual(ok({ loginId: fixture.person.loginId }).toJSON());
    const after = await readOwnProfileState(fixture);
    expect(after.hub.users.find((user) => user.id === fixture.person.loginId)).toEqual({
      ...before.hub.users.find((user) => user.id === fixture.person.loginId), pictureKey: null, updatedAt: expect.any(String),
    });
    expect(after.hub.users.filter((user) => user.id !== fixture.person.loginId)).toEqual(before.hub.users.filter((user) => user.id !== fixture.person.loginId));
    expect({ ...after, hub: { ...after.hub, users: before.hub.users } }).toEqual(before);
    expect(await readPictures()).toEqual(pictures.filter((object) => object.key !== previousKey));
  });

  it("when a person without a picture removes it again then the empty state stays valid", async () => {
    await removePicture({}, await preparePictureServices());
    const before = await readOwnProfileState(fixture), pictures = await readPictures();
    expect((await removePicture({}, await preparePictureServices())).toJSON()).toEqual(ok({ loginId: fixture.person.loginId }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before);
    expect(await readPictures()).toEqual(pictures);
  });

  it("when clearing the picture key fails then the old picture object is preserved", async () => {
    await sql`create trigger test_refuse_picture_removal before update of picture_key on user
      begin select raise(abort, 'private_picture_remove_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const before = await readOwnProfileState(fixture), pictures = await readPictures();
    expect((await removePicture({}, await preparePictureServices())).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before);
    expect(await readPictures()).toEqual(pictures);
  });

  it.each([
    { action: uploadPicture, input: { file: pictureFile("png") }, name: "upload" },
    { action: removePicture, input: {}, name: "remove" },
  ])("when a visitor tries to $name a picture then no state changes", async ({ action, input }) => {
    const before = await readOwnProfileState(fixture), pictures = await readPictures();
    const services = { ...await preparePictureServices(), ...await prepareProfileServices({ actor: null }) };
    expect((await action(input, services)).toJSON()).toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before);
    expect(await readPictures()).toEqual(pictures);
  });

  it("when someone supplies another login to picture removal then the request is refused", async () => {
    const before = await readOwnProfileState(fixture), pictures = await readPictures();
    expect((await removePicture({ loginId: fixture.other.loginId }, await preparePictureServices())).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: [] }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before);
    expect(await readPictures()).toEqual(pictures);
  });
});

describe("Accounts picture upload policy enforcement", () => {
  it("when uploads are paused then direct Accounts callers cannot process or store a picture", async () => {
    const before = await readOwnProfileState(fixture), pictures = await readPictures();
    const processPicture = vi.fn(async (_file: File) => ok<Blob, never>(squarePicture()));
    const services = { ...await preparePictureServices(), policy: { canUpload: false, maximumBytes: maximumPictureBytes }, processPicture };
    expect((await uploadPicture({ file: pictureFile("png") }, services)).toJSON())
      .toEqual(err({ code: "accounts_picture_uploads_unavailable" }).toJSON());
    expect(processPicture).not.toHaveBeenCalled();
    expect(await readOwnProfileState(fixture)).toEqual(before);
    expect(await readPictures()).toEqual(pictures);
  });

  it.each([1_048_576, 1_048_577])("when a reduced policy receives %s bytes then Accounts enforces its inclusive limit", async (size) => {
    const bytes = new Uint8Array(size); bytes.set(new Uint8Array(await pictureFile("jpeg").arrayBuffer()));
    const before = await readOwnProfileState(fixture), pictures = await readPictures();
    const processPicture = vi.fn(async (_file: File) => ok<Blob, never>(squarePicture()));
    const services = { ...await preparePictureServices(), policy: { canUpload: true, maximumBytes: 1_048_576 }, processPicture };
    const result = await uploadPicture({ file: new File([bytes], "portrait.jpg", { type: "image/jpeg" }) }, services);
    expect(result.toJSON()).toEqual(size === 1_048_576 ? ok({ loginId: fixture.person.loginId }).toJSON()
      : err({ code: "accounts_picture_too_large" }).toJSON());
    expect(processPicture).toHaveBeenCalledTimes(size === 1_048_576 ? 1 : 0);
    if (size > 1_048_576) {
      expect(await readOwnProfileState(fixture)).toEqual(before);
      expect(await readPictures()).toEqual(pictures);
    }
  });

  it("when an internal caller supplies an excessive policy limit then the absolute 2 MiB ceiling still applies", async () => {
    const before = await readOwnProfileState(fixture), pictures = await readPictures();
    const processPicture = vi.fn(async (_file: File) => ok<Blob, never>(squarePicture()));
    const services = { ...await preparePictureServices(), policy: { canUpload: true, maximumBytes: Number.MAX_SAFE_INTEGER }, processPicture };
    expect((await uploadPicture({ file: new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png") }, services)).toJSON())
      .toEqual(err({ code: "accounts_picture_too_large" }).toJSON());
    expect(processPicture).not.toHaveBeenCalled();
    expect(await readOwnProfileState(fixture)).toEqual(before);
    expect(await readPictures()).toEqual(pictures);
  });

  it("when uploads are paused then an existing picture can still be removed", async () => {
    const services = { ...await preparePictureServices(), policy: { canUpload: false, maximumBytes: maximumPictureBytes } };
    expect((await removePicture({}, services)).toJSON()).toEqual(ok({ loginId: fixture.person.loginId }).toJSON());
    expect((await readOwnProfileState(fixture)).hub.users.find((user) => user.id === fixture.person.loginId)?.pictureKey).toBeNull();
    expect((await readPictures()).some((picture) => picture.key === previousKey)).toBe(false);
  });
});

async function preparePictureServices(): Promise<PictureServices> {
  return { ...await prepareProfileServices({ actor: fixture.person }), pictures: env.PROFILE_PICTURES,
    policy: { canUpload: true, maximumBytes: maximumPictureBytes },
    async processPicture(_file) { return ok(squarePicture()); } };
}
