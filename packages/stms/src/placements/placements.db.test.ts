import { env } from "cloudflare:workers";
import { createRequestContext, saveHub } from "@xpro/core/server";
import { CompiledQuery } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSignInFixture, type SignInFixture } from "#test/sign-in";
import { preparePlacement, readPlacements, savePlacement } from "#test/routing";
import { placementQuery, readWorkspaceChoices, readWorkspaceOrigin, readWorkspacePlacement, resolvePlacement, workspaceChoicesQuery, workspaceOriginQuery, workspacePlacementQuery } from "./placements.db";

let fixture: SignInFixture;
beforeEach(async () => { fixture = await createSignInFixture(env.DB); });
afterEach(async () => { await fixture.identities.db.destroy(); });

describe("Prepared workspace directory", () => {
  it("when primary and custom addresses belong to one workspace then both resolve to its prepared app", async () => {
    const workspace = await preparePlacement(fixture, { alias: "https://erp.customer.test" });
    for (const origin of workspace.origins) {
      const expected = { workspaceId: workspace.id, workerName: workspace.workerName, origin };
      expect(await resolvePlacement(env.DB, origin)).toEqual(expected);
      expect(await env.HUB_PLACEMENT.resolvePlacement({ origin, context: createRequestContext() })).toEqual({ status: "found", placement: expected });
    }
    expect(await readWorkspaceOrigin(env.DB, workspace.id)).toBe(workspace.origin);
    expect(await readWorkspacePlacement(env.DB, workspace.id)).toEqual({ workspaceId: workspace.id, workerName: workspace.workerName, origin: workspace.origin });
    expect(await resolvePlacement(env.DB, "https://missing.test")).toBeNull();
    expect(await readWorkspaceOrigin(env.DB, crypto.randomUUID())).toBeNull();
    expect(await readWorkspacePlacement(env.DB, crypto.randomUUID())).toBeNull();
  });

  it("when directory lookups run then their real query plans use indexes without scanning shared tables", async () => {
    const workspace = await preparePlacement(fixture);
    const db = fixture.identities.db;
    for (const query of [placementQuery(db, workspace.origin), workspaceOriginQuery(db, workspace.id), workspacePlacementQuery(db, workspace.id),
      workspaceChoicesQuery(db), workspaceChoicesQuery(db, workspace.placementId)]) {
      const plan = await db.executeQuery<{ detail: string }>(CompiledQuery.raw("explain query plan " + query.sql, [...query.parameters]));
      expect(plan.rows.some((step) => step.detail.startsWith("SEARCH"))).toBe(true);
      expect(plan.rows.filter((step) => step.detail.startsWith("SCAN"))).toEqual([]);
    }
  });

  it("when a master pages prepared workspaces then every workspace appears once with its primary origin and no internal fields", async () => {
    // This query only needs native organizations and directory rows, not OAuth clients or MFA sessions.
    const prepared = [];
    for (let index = 0; index < 23; index++) {
      const { user: owner } = await fixture.identities.auth.api.createUser({ body: {
        email: "directory-owner-" + crypto.randomUUID() + "@example.test", name: "Directory owner", role: "user",
      } });
      const organization = await fixture.identities.auth.api.createOrganization({ body: {
        name: "Prepared workspace", slug: crypto.randomUUID(), userId: owner.id,
      } });
      if (!organization) throw new Error("The native API did not create the prepared workspace.");
      const workspace = { id: organization.id, origin: `https://w-${organization.id}.example.test` };
      prepared.push({ ...workspace, ...await savePlacement(fixture, workspace,
        index === 0 ? "https://custom.example.test" : undefined) });
    }
    const { user: unpreparedOwner } = await fixture.identities.auth.api.createUser({ body: {
      email: "unprepared-owner-" + crypto.randomUUID() + "@example.test", name: "Unprepared owner", role: "user",
    } });
    await fixture.identities.auth.api.createOrganization({ body: {
      name: "Not prepared", slug: crypto.randomUUID(), userId: unpreparedOwner.id,
    } });
    const expected = prepared.sort((a, b) => b.placementId.localeCompare(a.placementId));
    const first = await readWorkspaceChoices(env.DB), next = await readWorkspaceChoices(env.DB, first.nextCursor ?? "");
    const safe = expected.map((row) => ({ workspaceId: row.id, name: "Prepared workspace", origin: row.origin }));
    expect(first).toEqual({ workspaces: safe.slice(0, 20), nextCursor: expected[19]?.placementId });
    expect(next).toEqual({ workspaces: safe.slice(20), nextCursor: null });
    expect(await readWorkspaceChoices(env.DB, "00000000-0000-0000-0000-000000000000")).toEqual({ workspaces: [], nextCursor: null });
  });

  it("when another workspace claims an existing address then the database refuses it and all directory rows stay unchanged", async () => {
    const own = await preparePlacement(fixture);
    const other = await preparePlacement(fixture);
    const before = await readPlacements(fixture);
    await expect(saveHub(env.DB, [fixture.identities.db.insertInto("workspaceAddresses").values({
      id: crypto.randomUUID(), workspacePlacementId: other.placementId, origin: own.origin, isPrimary: 0, createdAt: new Date().toISOString(),
    }).compile()])).rejects.toThrow();
    expect(await readPlacements(fixture)).toEqual(before);
  });

  it("when an address points to a missing placement then its foreign key refuses the save", async () => {
    const before = await readPlacements(fixture);
    await expect(saveHub(env.DB, [fixture.identities.db.insertInto("workspaceAddresses").values({
      id: crypto.randomUUID(), workspacePlacementId: crypto.randomUUID(), origin: "https://unknown.test", isPrimary: 1, createdAt: new Date().toISOString(),
    }).compile()])).rejects.toThrow();
    expect(await readPlacements(fixture)).toEqual(before);
  });

  it("when one workspace is given two primary addresses then the second is refused", async () => {
    const workspace = await preparePlacement(fixture);
    const before = await readPlacements(fixture);
    await expect(saveHub(env.DB, [fixture.identities.db.insertInto("workspaceAddresses").values({
      id: crypto.randomUUID(), workspacePlacementId: workspace.placementId, origin: "https://second.test", isPrimary: 1, createdAt: new Date().toISOString(),
    }).compile()])).rejects.toThrow();
    expect(await readPlacements(fixture)).toEqual(before);
  });

  it.each([
    { origin: "http://unsafe.test" }, { origin: "https://UPPER.test" }, { isPrimary: 2 },
  ])("when a stored address violates its basic format ($origin, $isPrimary) then the save is refused", async (change) => {
    const workspace = await preparePlacement(fixture);
    const before = await readPlacements(fixture);
    await expect(saveHub(env.DB, [fixture.identities.db.updateTable("workspaceAddresses").set(change)
      .where("workspacePlacementId", "=", workspace.placementId).compile()])).rejects.toThrow();
    expect(await readPlacements(fixture)).toEqual(before);
  });
});
