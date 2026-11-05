import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { createWorkspaceDatabase, save } from "@xpro/core/server";
import { sql } from "kysely";
import { ok } from "true-myth/result";
import { describe, expect, it } from "vitest";
import { saveCreatedWorkspaceUser, type WorkspaceUserInput } from "./workspace-users.db";

describe("Workspace user creation save", () => {
  it.each(["internal", "external"] as const)("when a new %s user is saved then a repeat preserves the exact record and another workspace", async (kind) => {
    const input = creation(kind);
    const other = creation("internal");
    await submit(other);
    const otherBefore = await readUsers(other.workspaceId);
    const receipt = { variant: "Ok", value: { workspaceId: input.workspaceId, loginId: input.loginId, kind } };
    expect(await submit(input)).toEqual(receipt);
    const saved = await readUsers(input.workspaceId);
    expect(saved).toEqual([{ id: expect.any(String), loginId: input.loginId, kind, createdAt: expect.any(String), archivedAt: null }]);
    // A completed local step does not attempt another INSERT on retry.
    await inside(input.workspaceId, async ({ db }) => {
      await sql`create trigger test_refuse_repeat before insert on workspace_users begin select raise(abort, 'test_unnecessary_insert'); end`.execute(db);
    });
    expect(await submit(input)).toEqual(receipt);
    expect(await readUsers(input.workspaceId)).toEqual(saved);
    expect(await readUsers(other.workspaceId)).toEqual(otherBefore);
  });

  it.each(["kind", "archive"] as const)("when a saved user's %s conflicts with the creation then retry preserves it and refuses", async (field) => {
    const input = creation("internal");
    await submit(input);
    if (field === "archive") await inside(input.workspaceId, async ({ db, storage }) => {
      await save(storage, async () => { await db.updateTable("workspaceUsers").set({ archivedAt: new Date().toISOString() }).where("loginId", "=", input.loginId).execute(); return ok(undefined); });
    });
    const before = await readUsers(input.workspaceId);
    expect(await submit(field === "kind" ? { ...input, kind: "external" } : input)).toEqual({ variant: "Err", error: { code: "core_creation_incomplete" } });
    expect(await readUsers(input.workspaceId)).toEqual(before);
  });

  it.each([
    { value: { creationId: "bad" }, fields: ["creationId"] }, { value: { workspaceId: "bad" }, fields: ["workspaceId"] },
    { value: { loginId: "bad" }, fields: ["loginId"] }, { value: { kind: "admin" }, fields: ["kind"] },
    { value: { isMaster: true }, fields: [] },
  ])("when local input is invalid ($fields) then no user is saved", async ({ value, fields }) => {
    const input = creation("internal");
    expect(await submit({ ...input, ...value }, input.workspaceId)).toEqual({ variant: "Err", error: { code: "core_invalid_input", fields } });
    expect(await readUsers(input.workspaceId)).toEqual([]);
  });

  it("when the submitted workspace differs from storage scope then the write is forbidden", async () => {
    const input = creation("internal");
    const actualWorkspaceId = crypto.randomUUID();
    expect(await submit(input, actualWorkspaceId)).toEqual({ variant: "Err", error: { code: "core_forbidden" } });
    expect(await readUsers(actualWorkspaceId)).toEqual([]);
  });

  it("when the actual storage write fails then no partial user remains and the same input can be saved later", async () => {
    const input = creation("internal");
    await inside(input.workspaceId, async ({ db }) => {
      await sql`create trigger test_refuse_creation before insert on workspace_users begin select raise(abort, 'test_write_failed'); end`.execute(db);
    });
    await expect(submit(input)).rejects.toThrow("test_write_failed");
    expect(await readUsers(input.workspaceId)).toEqual([]);
    await inside(input.workspaceId, async ({ db }) => { await sql`drop trigger test_refuse_creation`.execute(db); });
    expect((await submit(input)).variant).toBe("Ok");
  });

  it("when eight requests create the same workspace user then one exact record and one receipt remain", async () => {
    const input = creation("internal");
    const replies = await Promise.all(Array.from({ length: 8 }, async () => await submit(input)));
    expect(replies).toEqual(Array.from({ length: 8 }, () => ({ variant: "Ok",
      value: { workspaceId: input.workspaceId, loginId: input.loginId, kind: input.kind } })));
    expect(await readUsers(input.workspaceId)).toHaveLength(1);
  });
});

function creation(kind: WorkspaceUserInput["kind"]): WorkspaceUserInput {
  return { creationId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), loginId: crypto.randomUUID(), kind };
}
async function submit(input: unknown, workspaceId?: string) {
  const parsedScope = input !== null && typeof input === "object" && "workspaceId" in input ? input.workspaceId : undefined;
  const scope = workspaceId ?? (typeof parsedScope === "string" ? parsedScope : crypto.randomUUID());
  return await inside(scope, async ({ storage }) => (await saveCreatedWorkspaceUser(input, { storage, workspaceId: scope })).toJSON());
}
async function readUsers(workspaceId: string) {
  return await inside(workspaceId, async ({ db }) => await db.selectFrom("workspaceUsers").selectAll().orderBy("id").execute());
}
async function inside<Value>(workspaceId: string, run: (services: {
  db: ReturnType<typeof createWorkspaceDatabase>; storage: DurableObjectStorage;
}) => Promise<Value>): Promise<Value> {
  return await runInDurableObject(env.WORKSPACES.getByName(workspaceId), async (_instance, state) => {
    const db = createWorkspaceDatabase(state.storage.sql);
    try { return await run({ db, storage: state.storage }); }
    finally { await db.destroy(); }
  });
}
