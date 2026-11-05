import { check, maxLength, object, pipe, regex, safeParse, string, uuid, type InferOutput } from "valibot";
import type { RequestContext } from "@xpro/core/server";

export const maxWorkspaceChoices = 20;
export type WorkspaceChoice = { workspaceId: string; name: string; origin: string };
export type WorkspaceChoicePage = { workspaces: WorkspaceChoice[]; nextCursor: string | null };

export const httpsOriginSchema = pipe(string(), check(isHttpsOrigin));
export const placementSchema = object({
  workspaceId: pipe(string(), uuid()),
  workerName: pipe(string(), maxLength(63), regex(/^xpro(?:-[a-z0-9-]+)?$/)),
  origin: httpsOriginSchema,
});
export type WorkspacePlacement = InferOutput<typeof placementSchema>;
export type PlacementLookup = { status: "found"; placement: WorkspacePlacement }
  | { status: "missing" | "unavailable" };
export type HubPlacementBinding = {
  resolvePlacement(input: { origin: string; context: RequestContext }): Promise<PlacementLookup>;
};

export function readPlacement(input: unknown, origin: string): WorkspacePlacement | null {
  const parsed = safeParse(placementSchema, input);
  return parsed.success && parsed.output.origin === origin ? parsed.output : null;
}

export function isHttpsOrigin(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && url.origin === value; }
  catch { return false; }
}
