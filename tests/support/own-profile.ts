import { env } from "cloudflare:workers";
import { createAccessRequest, createRequestContext, type AccessRequest, type RequestContext } from "@xpro/core/server";
export type { PictureServices } from "@xpro/accounts/server";
import type { SignedInLogin } from "./hub-identities";
import { createSignInFixture, readHubState, readWorkspaceState, type SignInFixture, type WorkspaceFixture } from "./sign-in";
import { changeNativePassword } from "../../apps/hub/src/functions/profile.server";

export type OwnProfileFixture = {
  signIn: SignInFixture; person: SignedInLogin; secondDevice: SignedInLogin; other: SignedInLogin;
  workspace: WorkspaceFixture; otherWorkspace: WorkspaceFixture;
};
export type ProfileServices = { database: D1Database; access: AccessRequest; context: RequestContext };
export type PasswordServices = ProfileServices & {
  changePassword(input: { currentPassword: string; newPassword: string; revokeOtherSessions: boolean }): Promise<Response>;
};
type OwnProfileState = {
  hub: Awaited<ReturnType<typeof readHubState>>;
  workspace: Awaited<ReturnType<typeof readWorkspaceState>>;
  otherWorkspace: Awaited<ReturnType<typeof readWorkspaceState>>;
};
type StoredPicture = { key: string; contentType: string | null; bytes: Uint8Array };

export async function createOwnProfileFixture(): Promise<OwnProfileFixture> {
  const signIn = await createSignInFixture(env.DB);
  try {
    const person = await signIn.identities.signIn();
    const secondDevice = await signIn.identities.signInAgain(person);
    const other = await signIn.identities.signIn();
    const workspace = await signIn.prepareWorkspace({ loginId: person.loginId });
    const otherWorkspace = await signIn.prepareWorkspace({ loginId: other.loginId, kind: "external" });
    return { signIn, person, secondDevice, other, workspace, otherWorkspace };
  } catch (error) { await signIn.identities.db.destroy(); throw error; }
}

export async function prepareProfileServices(
  input: { actor: SignedInLogin | null; database?: D1Database },
): Promise<ProfileServices> {
  const context = createRequestContext();
  const access = await createAccessRequest({ app: "hub", session: input.actor, workspaceId: null, hub: env.HUB_ACCESS, context });
  return { database: input.database ?? env.DB, access, context };
}

export async function preparePasswordServices(
  input: { fixture: OwnProfileFixture; actor: SignedInLogin | null; pageLoginId?: string },
): Promise<PasswordServices> {
  const services = await prepareProfileServices(input);
  return { ...services, async changePassword(body) {
    return await changeNativePassword(body, { auth: input.fixture.signIn.identities.auth,
      headers: { ...(input.actor ? { cookie: input.actor.cookie } : {}),
        ...(input.pageLoginId ? { "x-page-login-id": input.pageLoginId } : {}) }, context: services.context });
  } };
}

export async function readOwnProfileState(fixture: OwnProfileFixture): Promise<OwnProfileState> {
  const [hub, workspace, otherWorkspace] = await Promise.all([
    readHubState(fixture.signIn.identities), readWorkspaceState(fixture.workspace), readWorkspaceState(fixture.otherWorkspace),
  ]);
  return { hub, workspace, otherWorkspace };
}

export async function seedPicture(input: { fixture: OwnProfileFixture; login: SignedInLogin; file: Blob }): Promise<string> {
  const key = "profiles/" + input.login.loginId + "/" + crypto.randomUUID();
  await env.PROFILE_PICTURES.put(key, input.file.stream(), { httpMetadata: { contentType: input.file.type } });
  await (await input.fixture.signIn.identities.auth.$context).internalAdapter.updateUser(input.login.loginId, { pictureKey: key });
  return key;
}

export async function readPictures(): Promise<StoredPicture[]> {
  const listing = await env.PROFILE_PICTURES.list();
  if (listing.truncated) throw new Error("Picture fixtures must fit in a single R2 listing.");
  const objects = [];
  for (const entry of listing.objects) {
    const object = await env.PROFILE_PICTURES.get(entry.key);
    if (!object) throw new Error("A fixture picture disappeared while reading its state.");
    objects.push({ key: object.key, contentType: object.httpMetadata?.contentType ?? null,
      bytes: new Uint8Array(await object.arrayBuffer()) });
  }
  return objects.sort((left, right) => left.key.localeCompare(right.key));
}
