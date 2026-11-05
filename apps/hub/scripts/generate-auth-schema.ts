import { DatabaseSync } from "node:sqlite";
import { getMigrations } from "better-auth/db/migration";
import { createKyselyAdapter } from "@better-auth/kysely-adapter";
import { createHubAuthOptions } from "#auth/auth.server.ts";
import { createHubMigrator } from "#db/hub.db.ts";

// Tooling only. Production continues to use D1 in Workers.
const sqlite = new DatabaseSync(":memory:");
try {
  const options = createHubAuthOptions({
    database: sqlite,
    baseURL: "https://schema.invalid",
    secret: crypto.randomUUID() + crypto.randomUUID(),
  });
  const { kysely } = await createKyselyAdapter(options);
  if (!kysely) throw new Error("Better Auth did not provide its SQLite adapter.");
  const applied = await createHubMigrator(kysely).migrateToLatest();
  if (applied.error) throw applied.error;
  // This physical FK targets an xpro table, not a native auth model to join at runtime.
  const generated = await getMigrations({
    ...options,
    user: { ...options.user, additionalFields: { ...options.user.additionalFields, loginCreationId: {
      ...options.user.additionalFields.loginCreationId,
      references: { model: "login_creations", field: "id", onDelete: "restrict" },
    } } },
  }, { throwOnUnsafe: false });
  if (generated.schemaProblems.length || generated.unsafeChanges.length) {
    throw new Error(["Auth schema needs a manual additive migration:", ...generated.schemaProblems, ...generated.unsafeChanges].join("\n"));
  }
  const pending = generated.toBeCreated.length + generated.toBeAdded.length + generated.toBeAddedIndexes.length;
  if (process.argv.includes("--check")) {
    if (pending) throw new Error("Auth schema has pending changes. Generate and review a new Kysely migration.");
    console.log("Auth schema matches the application migrations.");
  } else if (pending) {
    // Review this SQL in a NEW dated Kysely migration; never overwrite an old snapshot.
    console.log(await generated.compileMigrations());
  } else {
    console.log("-- Auth schema matches the application migrations; no SQL changes.");
  }
} finally {
  sqlite.close();
}
