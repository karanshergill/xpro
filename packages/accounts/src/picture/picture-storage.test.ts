import { env } from "cloudflare:workers";
import { createHubConnection } from "@xpro/core/server";
import { CompiledQuery } from "kysely";
import { err, ok } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { interruptAfterWrite } from "#test/creation-faults.db";
import { createOwnProfileFixture, prepareProfileServices, readOwnProfileState, readPictures, seedPicture,
  type OwnProfileFixture, type PictureServices } from "#test/own-profile";
import { pictureFile, squarePicture } from "#test/picture-fixtures";
import { uploadPicture, removePicture } from "./picture.server";
import { changePictureQuery, readPictureQuery, type PictureTables } from "./picture.db";

let fixture: OwnProfileFixture;
let previousKey: string;
let otherKey: string;
beforeEach(async () => {
  fixture = await createOwnProfileFixture();
  previousKey = await seedPicture({ fixture, login: fixture.person, file: squarePicture() });
  otherKey = await seedPicture({ fixture, login: fixture.other, file: squarePicture() });
});
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("Picture storage safety", () => {
  it.each(["upload", "remove"] as const)(
    "when a newer upload wins before %s saves then the stale request cannot replace it or delete its object", async (action) => {
      let winner: Awaited<ReturnType<typeof readOwnProfileState>> | undefined;
      const database = interceptBatch(async (target, statements) => {
        expect((await uploadPicture({ file: pictureFile("png") }, await services())).toJSON()).toEqual(ok({ loginId: fixture.person.loginId }).toJSON());
        winner = await readOwnProfileState(fixture);
        return await target.batch(statements);
      });
      const input = action === "upload" ? { file: pictureFile("jpeg") } : {};
      const result = await (action === "upload" ? uploadPicture : removePicture)(input, await services(database));
      expect(result.toJSON()).toEqual(err({ code: "accounts_picture_changed" }).toJSON());
      expect(await readOwnProfileState(fixture)).toEqual(winner);
      const key = winner?.hub.users.find((row) => row.id === fixture.person.loginId)?.pictureKey;
      if (!key) throw new Error("The winning picture must keep its key.");
      const objects = await readPictures();
      expect(objects.map((object) => object.key).sort()).toEqual([key, otherKey].sort());
      expect(key).toMatch(/\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f-]+\.png$/);
    },
  );

  it("when the object write commits but loses its reply then the staged object is discarded and the previous picture stays", async () => {
    const pictures = new Proxy(env.PROFILE_PICTURES, { get(target, property, receiver) {
      if (property === "put") return async (...args: Parameters<R2Bucket["put"]>) => {
        await target.put(...args);
        throw new Error("private_object_reply_lost");
      };
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const before = await readOwnProfileState(fixture), objects = await readPictures();
    const configured = { ...await services(), pictures };
    expect((await uploadPicture({ file: pictureFile("png") }, configured)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before);
    expect(await readPictures()).toEqual(objects);
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: configured.context.requestId, app: "hub", operation: "accounts_upload_picture" })]]);
  });

  it.each(["upload", "remove"] as const)("when %s commits but its reply is lost then read-back confirms success without repeating the write", async (action) => {
    let writes = 0;
    const database = interceptBatch(async (target, statements) => {
      writes++;
      await target.batch(statements);
      throw new Error("private_picture_reply_lost");
    });
    const before = await readOwnProfileState(fixture);
    const input = action === "upload" ? { file: pictureFile("png") } : {};
    expect((await (action === "upload" ? uploadPicture : removePicture)(input, await services(database))).toJSON()).toEqual(ok({ loginId: fixture.person.loginId }).toJSON());
    expect(writes).toBe(1);
    const after = await readOwnProfileState(fixture);
    const key = after.hub.users.find((row) => row.id === fixture.person.loginId)?.pictureKey;
    expect(key).not.toBe(previousKey);
    expect(action === "upload" ? typeof key : key).toBe(action === "upload" ? "string" : null);
    expect((await readPictures()).map((object) => object.key).sort()).toEqual(action === "upload" ? [key, otherKey].sort() : [otherKey]);
    expect(after.hub.users.filter((row) => row.id !== fixture.person.loginId)).toEqual(before.hub.users.filter((row) => row.id !== fixture.person.loginId));
    expect({ ...after, hub: { ...after.hub, users: before.hub.users } }).toEqual(before);
  });

  it.each(["upload", "remove"] as const)("when %s confirmation is unavailable after commit then private files remain and no active picture is deleted", async (action) => {
    const database = interruptAfterWrite(env.DB, (query) => /^update "user" set "picture_key"/i.test(query));
    const configured = await services(database);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const before = await readOwnProfileState(fixture), objects = await readPictures();
    const input = action === "upload" ? { file: pictureFile("png") } : {};
    expect((await (action === "upload" ? uploadPicture : removePicture)(input, configured)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    const after = await readOwnProfileState(fixture);
    const key = after.hub.users.find((row) => row.id === fixture.person.loginId)?.pictureKey;
    expect(key).not.toBe(previousKey);
    const stored = await readPictures();
    expect(stored).toHaveLength(objects.length + (action === "upload" ? 1 : 0));
    expect(stored).toEqual(expect.arrayContaining(objects));
    if (action === "upload") {
      expect(stored.find((object) => object.key === key)).toEqual({
        key, contentType: "image/png", bytes: new Uint8Array(await squarePicture().arrayBuffer()),
      });
    } else expect(key).toBeNull();
    expect(after.hub.users.filter((row) => row.id !== fixture.person.loginId)).toEqual(before.hub.users.filter((row) => row.id !== fixture.person.loginId));
    expect({ ...after, hub: { ...after.hub, users: before.hub.users } }).toEqual(before);
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: configured.context.requestId, app: "hub", operation: action === "upload" ? "accounts_upload_picture" : "accounts_remove_picture" })]]);
  });

  it.each(["upload", "remove"] as const)(
    "when %s commits but old-object cleanup fails then the change succeeds and the private orphan is reported safely", async (action) => {
      const pictures = new Proxy(env.PROFILE_PICTURES, { get(target, property, receiver) {
        if (property === "delete") return async () => { throw new Error("private_picture_cleanup_failure"); };
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const configured = { ...await services(), pictures };
      const input = action === "upload" ? { file: pictureFile("png") } : {};
      expect((await (action === "upload" ? uploadPicture : removePicture)(input, configured)).toJSON()).toEqual(ok({ loginId: fixture.person.loginId }).toJSON());
      const state = await readOwnProfileState(fixture);
      const key = state.hub.users.find((row) => row.id === fixture.person.loginId)?.pictureKey;
      expect(action === "upload" ? typeof key : key).toBe(action === "upload" ? "string" : null);
      const objects = await readPictures();
      expect(objects.map((object) => object.key)).toEqual(expect.arrayContaining([previousKey, otherKey]));
      expect(objects).toHaveLength(action === "upload" ? 3 : 2);
      expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: configured.context.requestId, app: "hub", operation: "accounts_discard_previous_picture" })]]);
    },
  );

  it.each(["upload", "remove"] as const)(
    "when the stored key belongs to another login then %s cannot alter its object", async (action) => {
      await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.person.loginId, { pictureKey: otherKey });
      const before = await readOwnProfileState(fixture), objects = await readPictures();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const input = action === "upload" ? { file: pictureFile("png") } : {};
      expect((await (action === "upload" ? uploadPicture : removePicture)(input, await services())).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
      expect(await readOwnProfileState(fixture)).toEqual(before);
      expect(await readPictures()).toEqual(objects);
    },
  );

  it("when picture queries are planned then pointer reads and guarded writes use existing indexes without table scans", async () => {
    const db = await createHubConnection<PictureTables>(env.DB);
    try {
      const queries = [readPictureQuery(db, fixture.person.loginId), changePictureQuery(db, {
        loginId: fixture.person.loginId, previousKey, nextKey: null, updatedAt: new Date().toISOString(),
      })];
      for (const query of queries) {
        const plan = await db.withoutPlugins().executeQuery<{ detail: string }>(CompiledQuery.raw("explain query plan " + query.sql, [...query.parameters]));
        expect(plan.rows.some((row) => row.detail.startsWith("SEARCH user ") && row.detail.includes("INDEX"))).toBe(true);
        expect(plan.rows.filter((row) => /\bSCAN\b/.test(row.detail))).toEqual([]);
      }
    } finally { await db.destroy(); }
  });
});

async function services(database: D1Database = env.DB): Promise<PictureServices> {
  return { ...await prepareProfileServices({ actor: fixture.person, database }), pictures: env.PROFILE_PICTURES,
    policy: { canUpload: true, maximumBytes: 2 * 1024 * 1024 },
    async processPicture() { return ok(squarePicture()); } };
}

function interceptBatch(run: (target: D1Database, statements: D1PreparedStatement[]) => Promise<D1Result[]>): D1Database {
  return new Proxy(env.DB, { get(target, property, receiver) {
    if (property === "batch") return async (statements: D1PreparedStatement[]) => await run(target, statements);
    const value: unknown = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
