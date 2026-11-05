import { env } from "cloudflare:workers";
import { createHubConnection } from "@xpro/core/server";
import { betterAuth } from "better-auth";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Kysely } from "kysely";
import { interruptAfterWrite } from "#test/creation-faults.db";
import { createHubAuthOptions } from "#auth/auth.server.ts";
import * as initial from "./migrations/2026-10-27-010000-initial-hub";
import * as placements from "./migrations/2026-10-28-100900-workspace-placements";
import { up, type SearchNameTables } from "./migrations/2026-10-29-100000-login-search";

let schema: Kysely<unknown>;
let db: Kysely<SearchNameTables>;
beforeEach(async () => {
  schema = await createHubConnection<unknown>(env.DB);
  db = await createHubConnection<SearchNameTables>(env.DB);
  await initial.up(schema); await placements.up(schema);
  const auth = legacyAuth();
  await auth.$context;
  for (let index = 0; index < 32; index++) await auth.api.createUser({ body: {
    email: "legacy-" + crypto.randomUUID() + "@example.test", name: "  ÉLODIE Forge " + index + "  ", role: "user",
  } });
});
afterEach(async () => { await db.destroy(); await schema.destroy(); });

describe("Forward login-search migration", () => {
  it("when existing native logins are upgraded then only a derived search copy is added and repeating the migration is harmless", async () => {
    const before = await rows();
    await up(schema);
    const after = await rows();
    expect(after.map(({ name_search, ...row }) => { expect(name_search).toBe(row.name.trim().toLowerCase()); return row; })).toEqual(before);
    const indexes = await schema.introspection.getTables();
    expect(indexes.find((table) => table.name === "user")?.columns.filter((column) => column.name === "name_search")).toHaveLength(1);
    await up(schema);
    expect(await rows()).toEqual(after);
  });

  it("when a backfill chunk commits but its reply is lost then a fresh migration run resumes the missing copies", async () => {
    const before = await rows();
    const interrupted = await createHubConnection<unknown>(interruptAfterWrite(env.DB, (query) => /^update "user" set "name_search"/i.test(query)));
    try { await expect(up(interrupted)).rejects.toThrow(); }
    finally { await interrupted.destroy(); }
    const partial = await rows(), copied = partial.filter((row) => row.name_search !== null);
    expect(copied.length).toBeGreaterThan(0);
    expect(copied.length).toBeLessThan(partial.length);
    await up(schema);
    const after = await rows();
    expect(after.map(({ name_search, ...row }) => { expect(name_search).toBe(row.name.trim().toLowerCase()); return row; })).toEqual(before);
  });

  it("when more than one chunk is backfilled then every real update stays within D1's 100 bound-parameter limit", async () => {
    const counts: number[] = [];
    const limited = await createHubConnection<unknown>(withParameterLimit(counts));
    try { await up(limited); } finally { await limited.destroy(); }
    expect(counts.length).toBeGreaterThan(1);
    expect(counts.every((count) => count <= 100)).toBe(true);
    expect((await rows()).every((row) => row.name_search === row.name.trim().toLowerCase())).toBe(true);
  });
});

function legacyAuth() {
  const options = createHubAuthOptions({ database: env.DB, baseURL: "https://migration.example.test", secret: crypto.randomUUID() + crypto.randomUUID() });
  // This historical schema predates search and MFA. Use real native APIs with
  // only those later fields/plugin omitted; no xpro action is substituted.
  const { nameSearch, authRevision, ...additionalFields } = options.user.additionalFields;
  expect(nameSearch.fieldName).toBe("name_search");
  expect(authRevision.fieldName).toBe("auth_revision");
  return betterAuth({ ...options, user: { ...options.user, additionalFields },
    session: { ...options.session, additionalFields: {} }, verification: { additionalFields: {} },
    plugins: options.plugins.filter((plugin) => plugin.id !== "two-factor"),
  });
}

async function rows() {
  return await db.withoutPlugins().selectFrom("user").selectAll().orderBy("id").execute();
}

function withParameterLimit(counts: number[]): D1Database {
  return new Proxy(env.DB, { get(target, property, receiver) {
    if (property === "prepare") return (query: string) => {
      const statement = target.prepare(query);
      if (!/^update "user" set "name_search"/i.test(query)) return statement;
      return new Proxy(statement, { get(prepared, key) {
        if (key === "bind") return (...values: unknown[]) => {
          counts.push(values.length);
          if (values.length > 100) throw new Error("The external D1 parameter limit was exceeded.");
          return prepared.bind(...values);
        };
        const value: unknown = Reflect.get(prepared, key, prepared);
        return typeof value === "function" ? value.bind(prepared) : value;
      } });
    };
    const value: unknown = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
