import { describe, expect, it } from "vitest";
import { canCorrectCreation, createAttempt, initialCreationValues, isUncertainCreation, validateCreationValues, type CreationPageData } from "./creation";

const master: CreationPageData = { creatorLoginId: crypto.randomUUID(), scope: { kind: "master" } };
const tenant: CreationPageData = { creatorLoginId: crypto.randomUUID(), scope: { kind: "workspace", workspace: {
  workspaceId: crypto.randomUUID(), name: "Own workspace",
} } };
const details = { email: " PERSON@EXAMPLE.TEST ", username: "person1", name: " Person ",
  password: " Ordinary-pass123! ", phone: { country: "US", number: "(202) 555-0123" } };

describe("Create-login form requests", () => {
  it("when a master creates an unassigned login then normal details are normalized while the ordinary password stays verbatim", () => {
    const result = createAttempt({ ...initialCreationValues(master), ...details }, master);
    expect(result).toEqual({ wasUncertain: false, data: { creationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-7/),
      ...details, email: "person@example.test", name: "Person" } });
  });
  it("when a tenant changes browser scope hints then the request still targets their own workspace", () => {
    const result = createAttempt({ ...initialCreationValues(tenant), ...details, target: "standalone", workspaceId: crypto.randomUUID(), kind: "external" }, tenant);
    expect(result?.data).toMatchObject({ workspaceId: tenant.scope.kind === "workspace" ? tenant.scope.workspace.workspaceId : "", kind: "external" });
  });
  it("when a workspace request has no selection or type then submission is refused", () => {
    const values = { ...initialCreationValues(master), ...details, target: "workspace", kind: "admin" };
    expect(validateCreationValues(values, master)).toEqual({ workspaceId: expect.any(String), kind: expect.any(String) });
    expect(createAttempt(values, master)).toBeNull();
  });
  it.each([
    { email: "broken" }, { username: "Bad username" }, { name: " " }, { password: "short" },
    { phone: { country: "", number: "2025550123" } }, { phone: { country: "US", number: "" } },
    { phone: { country: "XX", number: "123" } }, { phone: { country: "US", number: "2025550123 ext 5" } },
  ])("when details violate the shared profile or password rules ($email, $username, $name) then no request is created", (change) => {
    expect(createAttempt({ ...initialCreationValues(master), ...details, ...change }, master)).toBeNull();
  });
  it.each(["core_invalid_input", "accounts_email_taken", "accounts_username_taken", "accounts_username_reserved", "accounts_username_invalid"])(
    "when a known refusal is %s then details can be corrected only before any uncertain outcome", (code) => {
      const attempt = createAttempt({ ...initialCreationValues(master), ...details }, master);
      if (!attempt) throw new Error("Valid request required.");
      expect(canCorrectCreation({ code }, attempt)).toBe(true);
      expect(canCorrectCreation({ code }, { ...attempt, wasUncertain: true })).toBe(false);
      expect(isUncertainCreation({ code })).toBe(false);
    });
  it.each(["core_unexpected_error", "unknown_error"])("when the result is %s then the same request must be retained", (code) => {
    const attempt = createAttempt({ ...initialCreationValues(master), ...details }, master);
    if (!attempt) throw new Error("Valid request required.");
    expect(isUncertainCreation({ code })).toBe(true);
    expect(canCorrectCreation({ code }, attempt)).toBe(false);
  });
  it.each(["core_unauthenticated", "core_identity_changed", "core_forbidden", "accounts_creation_conflict"])(
    "when authority or saved intent refuses a request (%s) then changing details is not offered", (code) => {
      const attempt = createAttempt({ ...initialCreationValues(master), ...details }, master);
      if (!attempt) throw new Error("Valid request required.");
      expect(canCorrectCreation({ code }, attempt)).toBe(false);
      expect(isUncertainCreation({ code })).toBe(false);
    });
});
