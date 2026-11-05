import { execFileSync } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import { v7 } from "uuid";
import { maximumPictureBytes } from "@xpro/accounts";
import { uploadPicture } from "@xpro/accounts/server";
import { browserOrigins } from "./addresses";
import { createHubAuth } from "../../apps/hub/src/auth/auth.server";
import { createHubDatabase, createHubMigrator } from "../../apps/hub/src/db/hub.db";
import { createRequestContext, saveHub } from "@xpro/core/server";
import { enrollMaster, mfaCookie } from "../support/master-mfa";
import { pictureFile } from "../support/picture-fixtures";
import { createHubAccess } from "../../apps/hub/src/functions/hub-request.server";
import { processPicture } from "../../apps/hub/src/functions/picture-processing.server";

const root = await realpath(fileURLToPath(new URL("../../", import.meta.url))), base = process.env.XPRO_BROWSER_TEMP;
if (!base || !basename(base).startsWith("xpro-browser-") || process.env.XPRO_BROWSER_ROOT !== root.replace(/\/$/, "")
  || JSON.parse(await readFile(join(base, "guard.json"), "utf8")).root !== root.replace(/\/$/, "") || dirname(root.replace(/\/$/, "")) !== base) {
  throw new Error("Browser fixtures require their isolated source copy.");
}
const logins: Record<string, { cookie: string; loginId: string; email: string; username: string | null }> = {};
const proxy = await getPlatformProxy<{ DB: D1Database; BETTER_AUTH_URL: string; BETTER_AUTH_SECRET: string; SIGN_IN_RATE_LIMITER: RateLimit;
  PROFILE_PICTURES: R2Bucket; IMAGES: ImagesBinding }>({
  configPath: join(root, "apps/hub/wrangler.jsonc"), environment: "local",
  persist: { path: join(root, "apps/hub/.wrangler/state/v3") }, remoteBindings: false,
});
try {
  if (proxy.env.BETTER_AUTH_URL !== "https://hub.localhost:3001") throw new Error("Browser fixtures require the local HTTPS Hub.");
  const db = await createHubDatabase(proxy.env.DB);
  try {
    const migrated = await createHubMigrator(db).migrateToLatest();
    if (migrated.error) throw migrated.error;
    const auth = await createHubAuth({ database: proxy.env.DB, baseURL: proxy.env.BETTER_AUTH_URL,
      secret: proxy.env.BETTER_AUTH_SECRET, rateLimiter: proxy.env.SIGN_IN_RATE_LIMITER });
    const context = await auth.$context;
    await context.checkSchema?.();
    const profiles: Record<string, string[]> = {
      profilePicturePaused: [], profilePictureReduced: [], profilePictureStale: [], profilePictureCropLimit: [],
      pictureUploadStandard: [], pictureUploadPaused: [], pictureUploadReduced: [],
      mfaInvalidEnrollment: [], mfaInvalidSignIn: [], mfaFresh: [], mfaSingleUse: [], mfaOldSession: [], mfaInterrupted: [], mfaNoFactors: [], mfaRevoked: [], mfaRateEnrollment: [], mfaRateSignIn: [], mfaPrivacy: [], mfaKeyboard: [], mfaLocale: [], mfaTransport: [], mfaLostBackups: [], mfaTampered: [],
      mfaManage: [], mfaReplace: [], mfaRefreshReplace: [], mfaLast: [], mfaLastBackups: [], mfaManageIdentity: [], mfaManageOther: [], mfaManageLost: [],
      mfaClearSetup: [], mfaClearSignIn: [], mfaRequestedReturning: ["name"], mfaRequested: [], mfaConcurrent: [], mfaNew: [], mfaRefresh: [], mfaRestart: [], mfaReturning: [], mfaBackup: [], mfaSigned: ["phone"], mfaSignedNew: ["phone"], mfaIdentity: [], mfaOther: [], mfaOrdinary: [],
      securityMaster: [], securityProfile: [],
      a11yMaster: [], a11yProfile: [], a11yIncomplete: ["username", "name", "phone"], a11yTarget: [], a11yAccount: [], a11yUnassigned: [],
      protocolAccount: [],
      username: ["username"], name: ["name"], phone: ["phone"], usernameName: ["username", "name"],
      usernamePhone: ["username", "phone"], namePhone: ["name", "phone"], all: ["username", "name", "phone"],
      invalid: ["username", "name", "phone"], blur: ["username", "name", "phone"], confirm: ["username", "name", "phone"],
      taken: ["username", "name", "phone"], reserved: ["username"], save: ["username", "name", "phone"],
      busy: ["username", "name", "phone"], locale: ["username", "name", "phone"],
      dark: ["username", "name", "phone"], concurrent: ["username", "name", "phone"],
      lostReply: ["username", "name", "phone"], expired: ["username", "name", "phone"],
      complete: [], oauth: ["phone"], master: [], other: [],
      incompleteSignIn: ["name"], emailSignIn: [], usernameSignIn: [], wrongSignIn: [], suspendedSignIn: [], archivedSignIn: [],
      masterSignIn: [], spacedSignIn: [], rateSignIn: [], pendingSignIn: [], lostSignIn: [], oauthSignIn: ["phone"],
      createMaster: [], createOtherMaster: [], createExpired: [], createOwner: [], createAdmin: [], createMember: [],
      stmsMaster: [], stmsLocaleMaster: [], stmsOtherMaster: [], stmsCancel: [], stmsListTarget: [], stmsSuspend: [], stmsOtherReason: [], stmsArchiveActive: [], stmsArchiveSuspended: [],
      stmsEmail: [], stmsUsername: [], stmsReset: [], stmsSelfEmail: [], stmsSelfUsername: [], stmsSelfReset: [], stmsBusy: [], stmsLostStatus: [], stmsLostEmail: [],
      stmsExpiredMaster: [], stmsExpired: [], stmsChanged: [], stmsLocale: [], stmsOtherTarget: [], stmsResetLostSelf: [],
      profileView: [], profileSave: [], profileMaster: [], profileValidation: [], profileAutofill: [], profileBusy: [], profileExpired: [], profileChanged: [], profilePicture: [], profilePictureOffset: [], profilePictureTypes: [], profilePictureLarge: [], profilePictureChanged: [], profilePictureLost: [], profilePassword: [], profilePasswordInvalid: [], profilePasswordLost: [], profileLocale: [], profileOther: [],
      resetMaster: [], resetOtherMaster: [], resetTargetMaster: [], resetSelf: [], resetSelfLost: [], resetExpired: [],
      resetTarget: [], resetComment: [], resetLost: [], resetBusy: [], resetAutofill: [], resetOther: [], resetIdentity: [], resetDelayed: [], resetValidation: [], resetExpiredTarget: [], resetLongEmail: [],
    };
    for (const [key, missing] of Object.entries(profiles)) {
      const email = key === "stmsLocale" ? "s" + "x".repeat(50) + "@example.test" : key === "resetLongEmail" ? "r" + "x".repeat(50) + "@example.test" : "screen-" + crypto.randomUUID() + "@example.test";
      const password = key === "spacedSignIn" ? " Browser-fixture123! " : "Browser-fixture123!";
      const username = missing.includes("username") ? null : key === "other" ? "takenusr" : "u" + crypto.randomUUID().replaceAll("-", "").slice(0, 7);
      const { user } = await auth.api.createUser({ body: { email, password, name: missing.includes("name") ? "" : "Existing name",
        role: ["mfaTampered", "mfaInvalidEnrollment", "mfaInvalidSignIn", "mfaFresh", "mfaSingleUse", "mfaOldSession", "mfaInterrupted", "mfaNoFactors", "mfaRevoked", "mfaRateEnrollment", "mfaRateSignIn", "mfaPrivacy", "mfaKeyboard", "mfaLocale", "mfaTransport", "mfaLostBackups", "mfaManage", "mfaReplace", "mfaRefreshReplace", "mfaLast", "mfaLastBackups", "mfaManageIdentity", "mfaManageOther", "mfaManageLost", "mfaClearSetup", "mfaClearSignIn", "mfaRequestedReturning", "mfaRequested", "mfaConcurrent", "mfaNew", "mfaRefresh", "mfaRestart", "mfaReturning", "mfaBackup", "mfaSigned", "mfaSignedNew", "mfaIdentity", "mfaOther", "securityMaster", "a11yMaster", "master", "masterSignIn", "complete", "createMaster", "createOtherMaster", "createExpired",
          "stmsMaster", "stmsLocaleMaster", "stmsOtherMaster", "stmsSelfEmail", "stmsSelfUsername", "stmsSelfReset", "stmsExpiredMaster", "stmsResetLostSelf", "profileMaster", "resetMaster", "resetOtherMaster", "resetTargetMaster", "resetSelf", "resetSelfLost", "resetExpired"].includes(key) ? "admin" : "user", data: {
          username,
          phone: missing.includes("phone") ? null : "+12025550123",
        } } });
      const signedIn = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
      if (!signedIn.ok) throw new Error("Native browser-fixture sign-in failed.");
      let cookie = mfaCookie(signedIn);
      if (user.role?.split(",").includes("admin") && !["mfaInvalidEnrollment", "mfaOldSession", "mfaRateEnrollment", "mfaPrivacy", "mfaKeyboard", "mfaLocale", "mfaClearSetup", "mfaRequested", "mfaConcurrent", "mfaNew", "mfaRefresh", "mfaRestart", "mfaSignedNew", "mfaIdentity", "mfaOther"].includes(key)) {
        const hasConsumedBackups = key === "mfaLast" || key === "mfaLastBackups" || key === "mfaNoFactors";
        // Only the outside limiter is replaced while consuming fixture codes;
        // browser requests still use the application's actual configured binding.
        const setupAuth = hasConsumedBackups ? await createHubAuth({ database: proxy.env.DB, baseURL: proxy.env.BETTER_AUTH_URL,
          secret: proxy.env.BETTER_AUTH_SECRET, rateLimiter: { async limit() { return { success: true }; } } }) : auth;
        const enrolled = await enrollMaster({ auth: setupAuth, identities: { db }, password }, { loginId: user.id, email, cookie });
        cookie = enrolled.cookie;
        if (hasConsumedBackups) for (const code of key === "mfaNoFactors" ? enrolled.backupCodes : enrolled.backupCodes.slice(0, -1)) {
          const challenge = await setupAuth.api.signInEmail({ body: { email, password }, asResponse: true });
          const completed = await setupAuth.api.verifyBackupCode({ headers: { cookie: mfaCookie(challenge) }, body: { code }, asResponse: true });
          if (!completed.ok) throw new Error("Native backup fixture consumption failed.");
          cookie = mfaCookie(completed);
        }
      }
      logins[key] = { cookie, loginId: user.id, email, username };
    }
    // External proxy streams lose their known length; keep real R2 writes using fixed-length bytes.
    const pictures = new Proxy(proxy.env.PROFILE_PICTURES, { get(bucket, name) {
      if (name !== "put") return Reflect.get(bucket, name);
      return async (...[key, body, options]: Parameters<R2Bucket["put"]>) => await bucket.put(key,
        body instanceof ReadableStream ? await new Response(body).arrayBuffer() : body, options);
    } });
    // Build pre-pause pictures through real Accounts/access/storage before seeding the control.
    for (const key of ["profilePicturePaused", "profilePictureStale"]) {
      const login = logins[key]; if (!login) throw new Error("Missing paused-picture fixture.");
      const context = createRequestContext(), settings = { database: proxy.env.DB, baseURL: proxy.env.BETTER_AUTH_URL, secret: proxy.env.BETTER_AUTH_SECRET };
      const { access } = await createHubAccess(new Request(settings.baseURL + "/profile", { headers: { cookie: login.cookie } }), { settings, context });
      const result = await uploadPicture({ file: pictureFile("png") }, { database: proxy.env.DB, access, context,
        pictures, policy: { canUpload: true, maximumBytes: maximumPictureBytes },
        async processPicture(file) { return await processPicture(file, proxy.env.IMAGES); } });
      if (result.isErr) throw new Error("Native pre-pause picture setup failed: " + result.error.code);
    }
    for (const [key, patch] of Object.entries({
      suspendedSignIn: { banned: 1 },
      archivedSignIn: { archivedAt: new Date().toISOString() },
    })) {
      const login = logins[key];
      if (!login) throw new Error("Missing sign-in fixture.");
      await saveHub(proxy.env.DB, [db.updateTable("user").set(patch).where("id", "=", login.loginId).compile()]);
    }
    const resetTarget = logins.resetTarget;
    if (!resetTarget) throw new Error("Missing reset target fixture.");
    const resetDevice = await auth.api.signInEmail({ body: { email: resetTarget.email, password: "Browser-fixture123!" }, asResponse: true });
    if (!resetDevice.ok) throw new Error("Native second-device sign-in failed.");
    logins.resetSecondDevice = { ...resetTarget,
      cookie: resetDevice.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") };
    const profileLogin = logins.profilePassword;
    if (!profileLogin) throw new Error("Missing profile password fixture.");
    const profileDevice = await auth.api.signInEmail({ body: { email: profileLogin.email, password: "Browser-fixture123!" }, asResponse: true });
    if (!profileDevice.ok) throw new Error("Native profile second-device sign-in failed.");
    logins.profilePasswordDevice = { ...profileLogin,
      cookie: profileDevice.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") };
    for (const key of ["stmsSuspend", "stmsEmail", "stmsUsername", "stmsReset"]) {
      const login = logins[key]; if (!login) throw new Error("Missing STMS device fixture.");
      const response = await auth.api.signInEmail({ body: { email: login.email, password: "Browser-fixture123!" }, asResponse: true });
      if (!response.ok) throw new Error("Native STMS second-device sign-in failed.");
      logins[key + "Device"] = { ...login, cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") };
    }
    for (let index = 0; index < 30; index++) {
      const email = "stms-directory-" + crypto.randomUUID() + "@example.test", username = "d" + crypto.randomUUID().replaceAll("-", "").slice(0, 7);
      const { user } = await auth.api.createUser({ body: { email, name: "Directory case " + String(index).padStart(2, "0"),
        role: "user", data: { username, phone: "+12025550123" } } });
      logins["stmsDirectory" + index] = { loginId: user.id, email, username, cookie: "" };
    }
    await auth.api.createUser({ body: { email: "literal-" + crypto.randomUUID() + "@example.test", name: '{"literal": 1}',
      role: "user", data: { username: "l" + crypto.randomUUID().replaceAll("-", "").slice(0, 7), phone: "+12025550123" } } });
    await saveHub(proxy.env.DB, [db.insertInto("reservedUsernames").values({
      id: crypto.randomUUID(), username: "reserved", addedAt: new Date().toISOString(),
    }).compile()]);
    const client = await auth.api.adminCreateOAuthClient({ headers: { cookie: logins.master?.cookie ?? "" }, body: {
      client_name: "Browser continuation", redirect_uris: ["https://workspace.example.test/auth/callback"],
      token_endpoint_auth_method: "client_secret_basic", grant_types: ["authorization_code"], response_types: ["code"],
      scope: "openid profile email", require_pkce: true, skip_consent: true,
    } });
    const { id: workspaceId } = await auth.api.createOrganization({ body: {
      name: "Browser workspace", slug: "browser-" + crypto.randomUUID(), userId: logins.master?.loginId,
    } });
    const workspaceOrigin = browserOrigins.workspace, customerOrigin = browserOrigins.customer;
    for (const key of ["protocolAccount", "a11yAccount"]) {
      const accountLogin = logins[key];
      if (!accountLogin) throw new Error("Missing account-holder fixture.");
      await saveHub(proxy.env.DB, [db.insertInto("accounts").values({ id: v7(), ownerLoginId: accountLogin.loginId,
        createdAt: new Date().toISOString() }).compile()]);
    }
    const workspaceClient = await auth.api.adminCreateOAuthClient({ headers: { cookie: logins.master?.cookie ?? "" }, body: {
      client_name: "Browser workspace", redirect_uris: [workspaceOrigin, customerOrigin].map((origin) => origin + "/auth/callback"),
      backchannel_logout_uri: customerOrigin + "/auth/back-channel-sign-out", backchannel_logout_session_required: true,
      token_endpoint_auth_method: "client_secret_basic", grant_types: ["authorization_code"], response_types: ["code"],
      scope: "openid profile email", require_pkce: true, skip_consent: true, enable_end_session: true, client_secret_expires_at: 0,
    } });
    const placementId = v7(), createdAt = new Date().toISOString();
    await saveHub(proxy.env.DB, [
      db.insertInto("workspacePlacements").values({ id: placementId, organizationId: workspaceId, workerName: "xpro", createdAt }).compile(),
      db.insertInto("workspaceAddresses").values({ id: v7(), workspacePlacementId: placementId,
        origin: workspaceOrigin, isPrimary: 1, createdAt }).compile(),
      db.insertInto("workspaceAddresses").values({ id: v7(), workspacePlacementId: placementId,
        origin: customerOrigin, isPrimary: 0, createdAt }).compile(),
    ]);
    for (const [key, role] of [["createOwner", "owner"], ["createAdmin", "admin"], ["createMember", "member"]] as const) {
      const login = logins[key];
      if (!login) throw new Error("Missing creation fixture.");
      await auth.api.addMember({ body: { userId: login.loginId, organizationId: workspaceId, role } });
    }
    const stmsMember = logins.stmsListTarget;
    if (!stmsMember) throw new Error("Missing STMS membership fixture.");
    await auth.api.addMember({ body: { userId: stmsMember.loginId, organizationId: workspaceId, role: "member" } });
    // Real directory rows exercise bounded paging and duplicate-name labels.
    // They are never dispatched; browser creation uses the running workspace above.
    for (let index = 0; index < 22; index++) {
      const { user } = await auth.api.createUser({ body: { email: "directory-" + crypto.randomUUID() + "@example.test",
        name: "Directory owner", role: "user" } });
      const organization = await auth.api.createOrganization({ body: {
        name: "Directory workspace", slug: "directory-" + crypto.randomUUID(), userId: user.id,
      } });
      const placement = v7(), timestamp = new Date().toISOString();
      await saveHub(proxy.env.DB, [
        db.insertInto("workspacePlacements").values({ id: placement, organizationId: organization.id,
          workerName: "xpro-" + organization.id, createdAt: timestamp }).compile(),
        db.insertInto("workspaceAddresses").values({ id: v7(), workspacePlacementId: placement,
          origin: "https://directory-" + index + ".example.test", isPrimary: 1, createdAt: timestamp }).compile(),
      ]);
    }
    if (!workspaceClient.client_secret) throw new Error("Missing native confidential client secret.");
    await writeFile(join(root, "apps/web/.dev.vars"),
      "WORKSPACE_ID=" + workspaceId + "\nWORKSPACE_ORIGINS=" + JSON.stringify([workspaceOrigin, customerOrigin])
      + "\nHUB_ORIGIN=" + proxy.env.BETTER_AUTH_URL + "\nOIDC_CLIENT_ID=" + workspaceClient.client_id
      + "\nOIDC_CLIENT_SECRET=" + workspaceClient.client_secret + "\nWORKSPACE_SESSION_SECRET=" + crypto.randomUUID() + crypto.randomUUID() + "\n",
      { mode: 0o600 });
    await writeFile(join(root, "apps/router/.dev.vars"), "HUB_ORIGIN=" + proxy.env.BETTER_AUTH_URL + "\n", { mode: 0o600 });
    await writeFile(join(base, "fixtures.json"), JSON.stringify({ logins, clientId: client.client_id,
      workspace: { id: workspaceId, origin: workspaceOrigin, customerOrigin, missingOrigin: browserOrigins.missing } }), { mode: 0o600 });
    console.log("Prepared isolated native browser fixtures.");
  } finally { await db.destroy(); }
} finally { await proxy.dispose(); }

const pausedLogin = logins.profilePicturePaused, reducedLogin = logins.profilePictureReduced;
const pausedUpload = logins.pictureUploadPaused, reducedUpload = logins.pictureUploadReduced;
const staleLogin = logins.profilePictureStale, cropLimitLogin = logins.profilePictureCropLimit;
if (!pausedLogin || !reducedLogin || !pausedUpload || !reducedUpload || !staleLogin || !cropLimitLogin) throw new Error("Missing picture-policy fixtures.");
const rules = [
  { priority: 1, conditions: [{ attribute: "targetingKey", operator: "in", value: [pausedLogin.loginId, pausedUpload.loginId, staleLogin.loginId] }], serve_variation: "paused" },
  { priority: 2, conditions: [{ attribute: "targetingKey", operator: "in", value: [reducedLogin.loginId, reducedUpload.loginId] }], serve_variation: "reduced" },
  { priority: 3, conditions: [{ attribute: "targetingKey", operator: "equals", value: cropLimitLogin.loginId }], serve_variation: "crop_limit" },
  { priority: 4, conditions: [{ attribute: "targetingKey", operator: "in", value: [...new Set(Object.values(logins).map((login) => login.loginId))] }], serve_variation: "standard" },
];
// Wrangler adds /v3 itself. Seed only after releasing the identity proxy's store.
for (const key of ["accounts_picture_policy", "accounts_picture_policy_disabled"]) {
  execFileSync(join(root, "node_modules/.bin/wrangler"), ["flagship", "flags", "create", "xpro-hub-local", key,
    "--config", join(root, "apps/hub/wrangler.jsonc"), "--env", "local", "--local",
    "--persist-to", join(root, "apps/hub/.wrangler/state"), "--type", "json",
    "--variation", "paused=" + JSON.stringify({ canUpload: false, maximumBytes: maximumPictureBytes }),
    "--variation", "standard=" + JSON.stringify({ canUpload: true, maximumBytes: maximumPictureBytes }),
    "--variation", "reduced=" + JSON.stringify({ canUpload: true, maximumBytes: 1_048_576 }),
    "--variation", "crop_limit=" + JSON.stringify({ canUpload: true, maximumBytes: 65_536 }),
    "--default-variation", "paused", ...rules.flatMap((rule) => ["--rule-json", JSON.stringify(rule)]),
    ...(key === "accounts_picture_policy_disabled" ? ["--disabled"] : []),
  ], { cwd: root, stdio: "inherit" });
}
