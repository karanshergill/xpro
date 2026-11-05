import { saveHub, type RequestContext } from "@xpro/core/server";
import type { CompiledQuery } from "kysely";
import { v7 } from "uuid";
import { createHubDatabase } from "#db/hub.db.ts";

export async function recordSignIn(database: D1Database, input: {
  loginId: string | null; reason: string | null; context: RequestContext;
}): Promise<void> {
  const db = await createHubDatabase(database);
  try {
    const isSuccess = input.reason === null;
    await saveHub(database, [db.insertInto("auditEntries").values({ id: v7(), action: "accounts_sign_in",
      outcome: isSuccess ? "success" : "refused", actorLoginId: isSuccess ? input.loginId : null,
      affectedLoginId: input.loginId, reason: input.reason, comment: null,
      requestId: input.context.requestId, createdAt: new Date().toISOString(),
    }).compile()]);
  } finally { await db.destroy(); }
}

type LoginByIdentifier = { id: string; archivedAt: string | null; authRevision: number };

export function loginIdentifierQuery(db: Awaited<ReturnType<typeof createHubDatabase>>, input: { method: "email" | "username"; identifier: string }): CompiledQuery<LoginByIdentifier> {
  return db.selectFrom("user").select(["id", "archivedAt", "authRevision"])
    .where(({ fn, ref, val, eb }) => eb(fn("lower", [fn("trim", [ref(input.method)])]), "=", fn("lower", [fn("trim", [val(input.identifier)])]))).compile();
}

export async function readLoginByIdentifier(database: D1Database, input: { method: "email" | "username"; identifier: string }): Promise<LoginByIdentifier | undefined> {
  const db = await createHubDatabase(database);
  try { return (await db.executeQuery(loginIdentifierQuery(db, input))).rows[0]; }
  finally { await db.destroy(); }
}
