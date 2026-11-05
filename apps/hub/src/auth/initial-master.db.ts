import { emailSchema, passwordSchema } from "@xpro/accounts";
import { createRequestContext, parseInput } from "@xpro/core/server";
import { v7 } from "uuid";
import { createHubDatabase } from "#db/hub.db.ts";
import { saveHub } from "#db/hub-save.db.ts";
import { createHubAuth, type HubAuthSettings } from "./auth.server";

type InitialMasterSettings = Omit<HubAuthSettings, "database"> & { database: D1Database };
type InitialMasterResult =
  | { status: "created"; loginId: string }
  | { status: "existing_logins" }
  | { status: "invalid_input"; fields: string[] };

export async function createInitialMaster(settings: InitialMasterSettings, input: unknown): Promise<InitialMasterResult> {
  const parsed = parseInput(input, { email: emailSchema, password: passwordSchema });
  if (parsed.isErr) return { status: "invalid_input", fields: parsed.error.fields };

  const db = await createHubDatabase(settings.database);
  try {
    // shortcut: private setup runs serially before the Hub accepts writes.
    // Add a database-backed setup claim before supporting concurrent setup.
    const existing = await db.selectFrom("user").select("id").limit(1).executeTakeFirst();
    if (existing) return { status: "existing_logins" };

    const auth = await createHubAuth(settings);
    const { user } = await auth.api.createUser({
      body: { ...parsed.value, name: "", role: "admin" },
    });
    // shortcut: native D1 creation and this audit are separate writes during private setup.
    // Add resumable setup before unattended or concurrent initialization is supported.
    await saveHub(settings.database, [db.insertInto("auditEntries").values({
      id: v7(), action: "stms_initial_master_created", outcome: "success",
      actorLoginId: null, affectedLoginId: user.id, reason: null, comment: null,
      requestId: (settings.requestContext ?? createRequestContext()).requestId,
      createdAt: new Date().toISOString(),
    }).compile()]);
    return { status: "created", loginId: user.id };
  } finally {
    await db.destroy();
  }
}
