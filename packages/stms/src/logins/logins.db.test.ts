import { env } from "cloudflare:workers";
import { createHubConnection } from "@xpro/core/server";
import { completeFirstSignIn, updateProfile } from "@xpro/accounts/server";
import { CompiledQuery } from "kysely";
import { err, ok } from "true-myth/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManagementFixture, prepareManagementServices, findManagementUser } from "#test/login-management";
import { readResetState, type ResetFixture } from "#test/reset-password";
import { listLogins, searchLogins } from "./logins.server";
import { listLoginsQuery, searchLoginsQuery, loginDetailQuery, type LoginsTables } from "./logins.db";

let fixture: ResetFixture;
beforeEach(async () => { fixture = await createManagementFixture(); });
afterEach(async () => { vi.restoreAllMocks(); await fixture.signIn.identities.db.destroy(); });

describe("Indexed master directory reads", () => {
  it.each([
    { label: "accented letters", name: "ÉLODIE Martin", query: "élo", neighbor: "Elodie" },
    { label: "supplementary characters", name: "😊Bench operator", query: "😊bEn", neighbor: "😊C" },
    { label: "200-character text", name: "x".repeat(200) + " child", query: "x".repeat(200), neighbor: "y" },
    { label: "more than 50 UTF-8 bytes", name: "é".repeat(60) + " Forge", query: "É".repeat(60), neighbor: "ê" },
    { label: "carried maximum code point", name: "edge\u{10ffff}suffix", query: "edge\u{10ffff}", neighbor: "edgf" },
    { label: "unbounded final range", name: "\u{10ffff} name", query: "\u{10ffff}", neighbor: "\u{10fffe}" },
    { label: "surrogate gap", name: "\ud7ff child", query: "\ud7ff", neighbor: "\ue000" },
    { label: "BMP boundary", name: "end\uffff tail", query: "end\uffff", neighbor: "end\u{10000}" },
    { label: "literal punctuation", name: "a\\!%_name", query: "a\\!%_", neighbor: "a\\!other" },
  ])("when $label is searched then its literal prefix excludes the next range", async ({ name, query, neighbor }) => {
    const native = await fixture.signIn.identities.auth.$context;
    await native.internalAdapter.updateUser(fixture.target.loginId, { name });
    await native.internalAdapter.updateUser(fixture.other.loginId, { name: neighbor });
    const before = await readResetState(fixture), row = findManagementUser(before, fixture.target.loginId);
    expect((await searchLogins({ query }, await prepareManagementServices({ actor: fixture.master }))).toJSON()).toEqual(ok({
      logins: [{ loginId: row.id, username: row.username, name: row.name, email: row.email,
        phone: row.phone, createdAt: row.createdAt, status: "active" }], nextOffset: null,
    }).toJSON());
    expect(await readResetState(fixture)).toEqual(before);
  });

  it.each([{ label: "high surrogate", query: "\ud800" }, { label: "low surrogate", query: "\udfff" }])(
    "when a query contains an unpaired $label then it is refused instead of producing an invalid range", async ({ query }) => {
    const before = await readResetState(fixture);
    expect((await searchLogins({ query }, await prepareManagementServices({ actor: fixture.master }))).toJSON())
      .toEqual(err({ code: "core_invalid_input", fields: ["query"] }).toJSON());
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when a login matches all three prefix fields then it appears once and does not create a false next page", async () => {
    await (await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.target.loginId,
      { name: "Amber engineer", username: "amber123", email: "amber@example.test" });
    const before = await readResetState(fixture), row = findManagementUser(before, fixture.target.loginId);
    expect((await searchLogins({ query: "amber", limit: 1 }, await prepareManagementServices({ actor: fixture.master }))).toJSON()).toEqual(ok({
      logins: [{ loginId: row.id, username: row.username, name: row.name, email: row.email,
        phone: row.phone, createdAt: row.createdAt, status: "active" }], nextOffset: null,
    }).toJSON());
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when native APIs create or rename a login then a submitted private search copy cannot poison directory results", async () => {
    const native = await fixture.signIn.identities.auth.$context;
    await native.internalAdapter.updateUser(fixture.target.loginId, { name: "ÉLODIE Forge", nameSearch: "forged-copy" });
    let state = await readResetState(fixture);
    expect(findManagementUser(state, fixture.target.loginId).nameSearch).toBe("élodie forge");
    const matched = await searchLogins({ query: "élo" }, await prepareManagementServices({ actor: fixture.master }));
    expect(matched.isOk && matched.value.logins.map((row) => row.loginId)).toEqual([fixture.target.loginId]);
    expect((await searchLogins({ query: "forged-copy" }, await prepareManagementServices({ actor: fixture.master }))).toJSON())
      .toEqual(ok({ logins: [], nextOffset: null }).toJSON());
    const created = await fixture.signIn.identities.auth.api.createUser({ body: {
      email: "search-" + crypto.randomUUID() + "@example.test", name: "ÉLODIE newcomer", role: "user", data: { nameSearch: "forged-copy" },
    } });
    expect(created.user).not.toHaveProperty("nameSearch");
    state = await readResetState(fixture);
    expect(findManagementUser(state, created.user.id).nameSearch).toBe("élodie newcomer");
    const session = await fixture.signIn.identities.auth.api.getSession({ headers: { cookie: fixture.target.cookie } });
    expect(session?.user).not.toHaveProperty("nameSearch");
  });

  it("when a native update tries to set only the private copy then the canonical name and its search copy both stay unchanged", async () => {
    const before = await readResetState(fixture);
    await expect((await fixture.signIn.identities.auth.$context).internalAdapter.updateUser(fixture.target.loginId,
      { nameSearch: "forged-copy" })).rejects.toMatchObject({ status: "BAD_REQUEST" });
    expect(await readResetState(fixture)).toEqual(before);
  });

  it("when own-profile SQL saves a name then search follows the new Unicode name and the old prefix disappears", async () => {
    expect((await updateProfile({ name: "  Élodie Factory  ", phone: { country: "US", number: "2025550123" } },
      await prepareManagementServices({ actor: fixture.target }))).toJSON()).toEqual(ok({ loginId: fixture.target.loginId }).toJSON());
    const after = await readResetState(fixture);
    expect(findManagementUser(after, fixture.target.loginId).nameSearch).toBe("élodie factory");
    const matched = await searchLogins({ query: "ÉLO" }, await prepareManagementServices({ actor: fixture.master }));
    expect(matched.isOk && matched.value.logins.map((row) => row.loginId)).toEqual([fixture.target.loginId]);
    expect((await searchLogins({ query: "Amber" }, await prepareManagementServices({ actor: fixture.master }))).toJSON())
      .toEqual(ok({ logins: [], nextOffset: null }).toJSON());
  });

  it("when profile completion saves a name then its derived copy is ready for directory searches in the same save", async () => {
    const login = await fixture.signIn.identities.signIn({ name: "", username: null, phone: null });
    expect((await completeFirstSignIn({ username: "newentry", name: "  ÉLODIE starter  ",
      phone: { country: "US", number: "2025550123" }, isUsernameConfirmed: true },
    await prepareManagementServices({ actor: login }))).toJSON()).toEqual(ok({ loginId: login.loginId }).toJSON());
    const after = await readResetState(fixture);
    expect(findManagementUser(after, login.loginId).nameSearch).toBe("élodie starter");
    const matched = await searchLogins({ query: "élo" }, await prepareManagementServices({ actor: fixture.master }));
    expect(matched.isOk && matched.value.logins.map((row) => row.loginId)).toEqual([login.loginId]);
  });

  it.each([NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("when an offset is not a safe integer (%s) then no read proceeds", async (offset) => {
    const services = await prepareManagementServices({ actor: fixture.master });
    expect((await listLogins({ offset }, services)).toJSON()).toEqual(err({ code: "core_invalid_input", fields: ["offset"] }).toJSON());
  });

  it("when queries are planned then list ordering, every search branch and membership detail use indexes without reading a whole base table", async () => {
    const db = await createHubConnection<LoginsTables>(env.DB);
    try {
      const queries = [listLoginsQuery(db, { limit: 25, offset: 0 }), searchLoginsQuery(db, { query: "Élo", limit: 25, offset: 0 }),
        loginDetailQuery(db, fixture.target.loginId)];
      const plans: string[][] = [];
      for (const query of queries) {
        const plan = await db.withoutPlugins().executeQuery<{ detail: string }>(CompiledQuery.raw("explain query plan " + query.sql, [...query.parameters]));
        const details = plan.rows.map((row) => row.detail); plans.push(details);
        expect(details.filter((detail) => /\bSCAN (user|member|organization)\b/.test(detail))).toEqual([]);
      }
      expect(plans[0]).toEqual(expect.arrayContaining([expect.stringContaining("user_login_list_idx")]));
      expect(plans[0]?.filter((detail) => detail.includes("TEMP B-TREE"))).toEqual([]);
      for (const index of ["user_login_name_prefix_idx", "user_email_normalized_unique", "user_username_normalized_unique"]) {
        expect(plans[1]).toEqual(expect.arrayContaining([expect.stringContaining(index)]));
      }
      for (const table of ["user", "member", "organization"]) {
        expect(plans[2]?.some((detail) => detail.startsWith("SEARCH " + table + " ") && detail.includes("INDEX"))).toBe(true);
      }
    } finally { await db.destroy(); }
  });
});
