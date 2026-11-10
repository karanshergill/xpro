import { env } from "cloudflare:workers";
import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { saveHub } from "@xpro/core/server";
import { v7 } from "uuid";
import { handleRouterRequest, type RouterServices } from "../../apps/router/src/routing.server";
import { handleHubRequest } from "../../apps/hub/src/auth/hub.server";
import type { WorkspaceRequestContext } from "../../apps/web/src/workspace/request.server";
import { handleWorkspaceObjectRequest } from "../../apps/web/src/workspace/object.server";
import type { WorkspaceEnvironment } from "../../apps/web/src/workspace/settings.server";
import { hubOrigin, readCookies, type SignInFixture, type WorkspaceFixture } from "./sign-in";
import type { SignedInLogin } from "./hub-identities";

export type PreparedWorkspace = WorkspaceFixture & { placementId: string; workerName: string; origins: string[] };

export async function preparePlacement(fixture: SignInFixture, input: {
  loginId?: string; kind?: "internal" | "external"; origin?: string; alias?: string;
} = {}): Promise<PreparedWorkspace> {
  const workspace = await fixture.prepareWorkspace({ ...input, aliases: input.alias ? [input.alias] : [] });
  return { ...workspace, ...await savePlacement(fixture, workspace, input.alias) };
}

export async function savePlacement(fixture: Pick<SignInFixture, "identities">,
  workspace: Pick<WorkspaceFixture, "id" | "origin">, alias?: string,
): Promise<Pick<PreparedWorkspace, "placementId" | "workerName" | "origins">> {
  const origins = [workspace.origin, ...(alias ? [alias] : [])];
  const placementId = v7(), workerName = "xpro-" + workspace.id;
  const createdAt = new Date().toISOString();
  await saveHub(env.DB, [
    fixture.identities.db.insertInto("workspacePlacements").values({ id: placementId, organizationId: workspace.id, workerName, createdAt }).compile(),
    ...origins.map((origin, index) => fixture.identities.db.insertInto("workspaceAddresses").values({
      id: v7(), workspacePlacementId: placementId, origin, isPrimary: index === 0 ? 1 : 0, createdAt,
    }).compile()),
  ]);
  return { placementId, workerName, origins };
}

export async function route(request: Request, services: Omit<RouterServices, "execution">): Promise<Response> {
  const execution = createExecutionContext();
  const response = await handleRouterRequest(request, { ...services, execution });
  await waitOnExecutionContext(execution);
  return response;
}

export function routingServices(fixture: SignInFixture, workspaces: PreparedWorkspace[]): Omit<RouterServices, "execution"> {
  return { placements: env.PLACEMENTS, hubPlacement: env.HUB_PLACEMENT, hubOrigin,
    hub: { async fetch(request) { return await fetchHub(request, fixture); } },
    // Only the external dispatch API is adapted. It invokes the real workspace boundary and storage.
    dispatch: { get(workerName) {
      const workspace = workspaces.find((current) => current.workerName === workerName);
      if (!workspace) throw new Error("Worker not found");
      return { async fetch(request) { return await fetchWorkspace(request, { fixture, workspace }); } };
    } } };
}

export async function fetchHub(request: Request, fixture: SignInFixture): Promise<Response> {
  const response = await handleHubRequest(request, fixture.settings);
  if (!response) throw new Error("A screen outside the backend routing contract was requested.");
  return response;
}

export function workspaceEnvironment(fixture: SignInFixture, workspace: PreparedWorkspace): WorkspaceEnvironment {
  return { WORKSPACE_ID: workspace.id, WORKSPACE_ORIGINS: JSON.stringify(workspace.origins), HUB_ORIGIN: hubOrigin,
    OIDC_CLIENT_ID: workspace.clientId, OIDC_CLIENT_SECRET: workspace.clientSecret, WORKSPACE_SESSION_SECRET: workspace.secret,
    WORKSPACES: env.WORKSPACES, HUB_ACCESS: env.HUB_ACCESS,
    HUB: { async fetch(request: Request) { return await fetchHub(request, fixture); } } };
}

export async function fetchWorkspace(request: Request, input: { fixture: SignInFixture; workspace: PreparedWorkspace;
  render?: (request: Request, context: WorkspaceRequestContext) => Promise<Response> }): Promise<Response> {
  const { fixture, workspace } = input;
  const payload = { url: request.url, method: request.method, headers: [...request.headers],
    body: request.body ? await request.text() : undefined };
  return await runInDurableObject(workspace.stub, async (_instance, state) => {
    const current = new Request(payload.url, { method: payload.method, headers: payload.headers, body: payload.body });
    return await handleWorkspaceObjectRequest(current, { state, env: workspaceEnvironment(fixture, workspace),
      render: input.render ?? (async (_request, access) => Response.json({ workspaceId: access.workspaceId, loginId: access.actor.loginId, kind: access.kind })),
    });
  });
}

export async function readPlacements(fixture: SignInFixture) {
  return { placements: await fixture.identities.db.selectFrom("workspacePlacements").selectAll().orderBy("id").execute(),
    addresses: await fixture.identities.db.selectFrom("workspaceAddresses").selectAll().orderBy("id").execute() };
}

export async function signInViaRouter(input: {
  fixture: SignInFixture; workspace: PreparedWorkspace; login: SignedInLogin; origin?: string;
}): Promise<{ cookie: string; response: Response }> {
  const origin = input.origin ?? input.workspace.origin;
  const services = routingServices(input.fixture, [input.workspace]);
  const started = await route(new Request(origin + "/auth/start"), services);
  const authorization = started.headers.get("location");
  if (!authorization) throw new Error("The routed workspace did not start sign-in.");
  const authorized = await fetchHub(new Request(authorization, { headers: { cookie: input.login.cookie } }), input.fixture);
  const callback = authorized.headers.get("location");
  if (!callback) throw new Error("The Hub did not return a callback.");
  const response = await route(new Request(callback, { headers: { cookie: readCookies(started) } }), services);
  return { response, cookie: readCookies(response) };
}
