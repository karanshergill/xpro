import { env } from "cloudflare:workers";
import { saveHub, type CoreError } from "@xpro/core/server";
import { sql } from "kysely";
import { err, ok, type Result } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnProfileFixture, prepareProfileServices, readOwnProfileState,
  type OwnProfileFixture, type ProfileServices } from "#test/own-profile";
import { updateProfile as update } from "./update-profile.server";

const updateProfile: (input: unknown, services: ProfileServices) => Promise<Result<{ loginId: string }, CoreError>> = update;
let fixture: OwnProfileFixture;
beforeEach(async () => { fixture = await createOwnProfileFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("Story 4 — own profile", () => {
  it("when a signed-in person changes their name or phone number then the change is saved and neither is left empty", async () => {
    const before = await readOwnProfileState(fixture);
    const result = await updateProfile(validInput(), await prepareProfileServices({ actor: fixture.person }));
    expect(result.toJSON()).toEqual(ok({ loginId: fixture.person.loginId }).toJSON());
    const after = await readOwnProfileState(fixture);
    const original = before.hub.users.find((user) => user.id === fixture.person.loginId);
    const saved = after.hub.users.find((user) => user.id === fixture.person.loginId);
    if (!original || !saved) throw new Error("The profile fixture must keep its login.");
    expect(saved).toEqual({ ...original, name: "Updated person", nameSearch: "updated person", phone: "+442079460018", updatedAt: expect.any(String) });
    expect(Number.isFinite(Date.parse(saved.updatedAt))).toBe(true);
    expect({ ...after, hub: { ...after.hub, users: before.hub.users } }).toEqual(before);
    expect(after.hub.users.filter((user) => user.id !== fixture.person.loginId))
      .toEqual(before.hub.users.filter((user) => user.id !== fixture.person.loginId));
    const session = await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: fixture.person.cookie }, query: { disableCookieCache: true } });
    expect(session?.user.name).toBe("Updated person");
  });

  it.each([
    { input: { name: "", phone: { country: "GB", number: "020 7946 0018" } }, fields: ["name"] },
    { input: { name: " \t ", phone: { country: "GB", number: "020 7946 0018" } }, fields: ["name"] },
    { input: { name: "Person", phone: { country: "GB", number: "" } }, fields: ["phone"] },
    { input: { name: "Person", phone: { country: "XX", number: "020 7946 0018" } }, fields: ["phone"] },
    { input: { name: "Person", phone: { country: "GB", number: "123" } }, fields: ["phone"] },
    { input: { name: "Person", phone: { country: "US", number: "2025550123 ext 9" } }, fields: ["phone"] },
    { input: { name: "", phone: null }, fields: ["name", "phone"] },
    { input: {}, fields: ["name", "phone"] },
    { input: null, fields: [] },
  ])("when profile input is invalid ($fields) then the whole save is refused", async ({ input, fields }) => {
    const before = await readOwnProfileState(fixture);
    expect((await updateProfile(input, await prepareProfileServices({ actor: fixture.person }))).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before);
  });

  it.each(["email", "username", "loginId", "role", "pictureKey", "loginCreationId"])(
    "when someone submits the read-only or server-owned field %s then no details change", async (field) => {
      const before = await readOwnProfileState(fixture);
      expect((await updateProfile({ ...validInput(), [field]: fixture.other.loginId },
        await prepareProfileServices({ actor: fixture.person }))).toJSON()).toEqual(err({ code: "core_invalid_input", fields: [] }).toJSON());
      expect(await readOwnProfileState(fixture)).toEqual(before);
    },
  );

  it("when a master uses the own-profile action then only that master's profile changes", async () => {
    const master = await fixture.signIn.signInMaster();
    const before = await readOwnProfileState(fixture);
    expect((await updateProfile(validInput(), await prepareProfileServices({ actor: master }))).toJSON())
      .toEqual(ok({ loginId: master.loginId }).toJSON());
    const after = await readOwnProfileState(fixture);
    expect(after.hub.users.find((user) => user.id === master.loginId)).toEqual({
      ...before.hub.users.find((user) => user.id === master.loginId),
      name: "Updated person", nameSearch: "updated person", phone: "+442079460018", updatedAt: expect.any(String),
    });
    expect(after.hub.users.filter((user) => user.id !== master.loginId)).toEqual(before.hub.users.filter((user) => user.id !== master.loginId));
    expect({ ...after, hub: { ...after.hub, users: before.hub.users } }).toEqual(before);
  });

  it("when there is no signed-in person then the profile action is refused", async () => {
    const before = await readOwnProfileState(fixture);
    expect((await updateProfile(validInput(), await prepareProfileServices({ actor: null }))).toJSON())
      .toEqual(err({ code: "core_unauthenticated" }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before);
  });

  it.each(["banned", "archivedAt", "phone"] as const)(
    "when live Hub field %s prevents protected access then profile saving cannot bypass the gate", async (field) => {
      await saveHub(env.DB, [fixture.signIn.identities.db.updateTable("user")
        .set(field, field === "banned" ? 1 : field === "archivedAt" ? new Date().toISOString() : null)
        .where("id", "=", fixture.person.loginId).compile()]);
      const before = await readOwnProfileState(fixture);
      const error = field === "phone" ? { code: "core_profile_incomplete", fields: ["phone"] } : { code: "core_login_inactive" };
      expect((await updateProfile(validInput(), await prepareProfileServices({ actor: fixture.person }))).toJSON()).toEqual(err(error).toJSON());
      expect(await readOwnProfileState(fixture)).toEqual(before);
    },
  );

  it("when the profile write fails then both previous details stay and only a safe error is reported", async () => {
    await sql`create trigger test_refuse_profile_update before update of name, phone on user
      begin select raise(abort, 'private_profile_database_failure'); end`.execute(fixture.signIn.identities.db.withoutPlugins());
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const services = await prepareProfileServices({ actor: fixture.person });
    const before = await readOwnProfileState(fixture);
    expect((await updateProfile(validInput(), services)).toJSON()).toEqual(err({ code: "core_unexpected_error" }).toJSON());
    expect(await readOwnProfileState(fixture)).toEqual(before);
    expect(log.mock.calls).toEqual([[JSON.stringify({ event: "core_unexpected_error", requestId: services.context.requestId, app: "hub", operation: "accounts_update_profile" })]]);
  });
});

function validInput() { return { name: "  Updated person  ", phone: { country: "GB", number: "020 7946 0018" } }; }
