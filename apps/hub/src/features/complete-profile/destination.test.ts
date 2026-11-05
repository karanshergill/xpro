import { describe, expect, it } from "vitest";
import { readDirectDestination } from "./destination";

describe("fixed Hub continuation", () => {
  it.each(["", "?intent=replace", "?callbackURL=https://untrusted.test", "?intent=replace&other=ignored"])("when search is display-only then it cannot choose a return address", (search) => {
    expect(readDirectDestination(search)).toBe("/auth/destination");
  });
  it("when a workspace was requested then only its selection survives the fixed Hub detour", () => {
    const requestedWorkspaceId = crypto.randomUUID();
    expect(readDirectDestination("?intent=replace&requestedWorkspaceId=" + requestedWorkspaceId + "&callbackURL=https://untrusted.test"))
      .toBe("/auth/destination?requestedWorkspaceId=" + requestedWorkspaceId);
  });
  it.each(["?requestedWorkspaceId=bad", "?requestedWorkspaceId=", "?requestedWorkspaceId=https://untrusted.test", "?requestedWorkspaceId=bad&requestedWorkspaceId=other"])(
    "when a workspace selection is malformed or ambiguous then continuation refuses it", (search) => { expect(readDirectDestination(search)).toBeNull(); },
  );
});
