import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { network } from "#test/network";

describe("Workers test infrastructure", () => {
  it("when D1 is queried then it runs with the local binding", async () => {
    expect(await env.DB.prepare("SELECT ? AS value").bind("d1_test").first()).toEqual({ value: "d1_test" });
  });

  it("when a workspace uses SQLite then another workspace has separate storage", async () => {
    const first = env.WORKSPACES.getByName("first");
    const second = env.WORKSPACES.getByName("second");
    await runInDurableObject(first, async (_instance, state) => {
      await state.storage.put("runtime_test", "first");
      expect(state.storage.sql.exec("SELECT ? AS value", "sqlite_test").one()).toEqual({ value: "sqlite_test" });
    });
    expect(await runInDurableObject(second, async (_instance, state) => await state.storage.get("runtime_test"))).toBeUndefined();
    expect(await runInDurableObject(first, async (_instance, state) => await state.storage.get("runtime_test"))).toBe("first");
  });

  it("when KV is used then values can be saved and read", async () => {
    await env.PLACEMENTS.put("runtime_test", "placement");
    expect(await env.PLACEMENTS.get("runtime_test")).toBe("placement");
  });

  it("when R2 is used then an object can be saved and read", async () => {
    await env.PROFILE_PICTURES.put("runtime_test", "image");
    const object = await env.PROFILE_PICTURES.get("runtime_test");
    expect(await object?.text()).toBe("image");
  });

  it("when an external request is declared then MSW supplies its response", async () => {
    network.use(http.get("https://outside.example.test/profile", () => HttpResponse.json({ id: "profile" })));
    const response = await fetch("https://outside.example.test/profile");
    expect(await response.json()).toEqual({ id: "profile" });
  });

  it("when a rejection is handled within the microtask checkpoint then it remains handled", async () => {
    const error = new Error("Handled test rejection");
    const pending = Promise.reject(error);
    await Promise.resolve();
    await expect(pending).rejects.toBe(error);
  });
});
