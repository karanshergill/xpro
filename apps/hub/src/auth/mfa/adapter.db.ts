import type { DBAdapter } from "@better-auth/core/db/adapter";
import { getCurrentAuthEndpointContext } from "@better-auth/core/context";
import { MFA_SETUP_ID_HEADER, readAuthSource, readMfaOperation, refuseMfaWrite, type AuthSource } from "./context.db";
import { assertMfaSource, commitMfaPhase, currentMfaSource, mfaAuditClaim, mfaPhaseClaim, mfaRevocations, type MfaStorage } from "./phases.db";
import { guardedFactorUpdate, nativeFactorValues } from "./factor-query.db";

export function guardMfaAdapter(adapter: DBAdapter, storage: MfaStorage): DBAdapter {
  const { db } = storage;
  const original = {
    create: adapter.create, update: adapter.update, updateMany: adapter.updateMany, incrementOne: adapter.incrementOne,
    delete: adapter.delete, deleteMany: adapter.deleteMany, consumeOne: adapter.consumeOne, findOne: adapter.findOne,
  };
  adapter.create = async <T extends Record<string, unknown>, R = T>(input: {
    model: string; data: Omit<T, "id">; select?: string[]; forceAllowId?: boolean;
  }): Promise<R> => {
    if (input.model === "twoFactor") {
      const value = await readMfaOperation(), native = input.data;
      if (!value || value.kind !== "setup" || value.factor || Object.keys(native)
        .some((key) => !["id", "userId", "secret", "backupCodes", "verified"].includes(key))) refuseMfaWrite();
      const endpoint = getCurrentAuthEndpointContext();
      if (!endpoint.setHeader) refuseMfaWrite();
      const id = typeof native.id === "string" ? native.id : endpoint.context.generateId({ model: "twoFactor" });
      if (typeof id !== "string" || native.verified !== false || native.userId !== value.userId
        || typeof native.secret !== "string" || typeof native.backupCodes !== "string") refuseMfaWrite();
      await commitMfaPhase(storage, [
        mfaAuditClaim(db, { operation: value, action: "accounts_mfa_setup_started" }),
        db.insertInto("twoFactor").columns(["id", "userId", "secret", "backupCodes", "verified", "failedVerificationCount", "lockedUntil"])
          .expression(db.selectFrom("audit_entries").where("id", "=", value.auditId).select((eb) => [
            eb.val(id).as("id"), eb.val(value.userId).as("userId"), eb.val(native.secret).as("secret"),
            eb.val(native.backupCodes).as("backupCodes"), eb.val(0).as("verified"), eb.val(0).as("failedVerificationCount"), eb.val(null).as("lockedUntil"),
          ])).compile(),
      ]);
      const created = await original.findOne<R>({ model: "twoFactor", where: [{ field: "id", value: id }], select: input.select });
      if (created === null) refuseMfaWrite();
      // Bind private setup output to this committed factor, even if another
      // request replaces it before a later page read. Never read a request hint.
      endpoint.setHeader(MFA_SETUP_ID_HEADER, id);
      return created;
    }
    const data = input.data;
    if (input.model === "user" && !hasInitialUserMetadata(data)) refuseMfaWrite();
    if (input.model === "verification" && !hasUnrelatedVerificationMetadata(data)) {
      const source = await readAuthSource();
      if (!source || source.kind !== "credential" || !isMainMfaChallenge(data.identifier) || data.value !== source.loginId
        || data.authRevision !== source.revision || hasPhysicalFields(data) || "mfaVerifiedAt" in data || "twoFactorEnabled" in data) refuseMfaWrite();
      const user = await original.findOne<{ authRevision: number }>({ model: "user", where: [{ field: "id", value: source.loginId }] });
      if (!user || user.authRevision !== source.revision) refuseMfaWrite();
    }
    if (input.model !== "session") return await original.create<T, R>(input);
    const source = await readAuthSource();
    if (source?.kind === "mfa") {
      const value = source.operation;
      if (value.userId !== data.userId || hasPhysicalFields(data) || "twoFactorEnabled" in data
        || data.mfaVerifiedAt !== null && data.mfaVerifiedAt !== undefined
        || data.authRevision !== value.revision) refuseMfaWrite();
      if (!(value.kind === "activate" && value.phase === "activated" || value.kind === "verify" && value.consumed
        || value.kind === "disable" && value.phase === "disabled" || value.kind === "password" && value.phase === "password_saved")) refuseMfaWrite();
      await assertMfaSource(db, value);
      return await original.create<T, R>({ ...input, data: { ...data, authRevision: value.revision, mfaVerifiedAt: null } });
    }
    if (!source || !matchesSessionSource(source, data)) refuseMfaWrite();
    const user = await original.findOne<{ authRevision: number }>({
      model: "user", where: [{ field: "id", value: source.loginId }],
    });
    if (!user || user.authRevision !== source.revision) refuseMfaWrite();
    // Native session defaults are prepared before this boundary. Replace that zero
    // with the original source revision, never with the newer value read above.
    return await original.create<T, R>({ ...input, data: {
      ...data, authRevision: source.revision, mfaVerifiedAt: null,
    } });
  };
  adapter.update = async (input) => {
    const value = await readMfaOperation();
    if (input.model === "account" && "password" in input.update) {
      if (!value || value.kind !== "password" || value.phase !== "sessions_ended" || !value.account
        || typeof value.account.password !== "string" || typeof input.update.password !== "string"
        || Object.keys(input.update).some((key) => !["password", "updatedAt"].includes(key))
        || !matchesId(input.where, value.account.id)) refuseMfaWrite();
      await commitMfaPhase(storage, [
        mfaAuditClaim(db, { operation: value, action: "accounts_password_changed" }),
        db.updateTable("account").set({ password: input.update.password, updatedAt: new Date().toISOString() })
          .where("id", "=", value.account.id).where("password", "=", value.account.password).where(mfaPhaseClaim(db, value)).compile(),
        db.updateTable("user").set({ auth_revision: value.revision + 1 }).where("id", "=", value.userId).where(mfaPhaseClaim(db, value)).compile(),
        ...mfaRevocations(db, value),
      ]);
      value.revision += 1; value.phase = "password_saved";
      return await original.findOne({ model: "account", where: [{ field: "id", value: value.account.id }] });
    }
    if (input.model === "user" && "twoFactorEnabled" in input.update) {
      if (!value || value.phase !== "running" || value.kind !== "activate" && value.kind !== "disable" || !value.factor
        || Object.keys(input.update).some((key) => !["twoFactorEnabled", "updatedAt"].includes(key))) refuseMfaWrite();
      const activate = value.kind === "activate";
      if (input.update.twoFactorEnabled !== activate || !matchesId(input.where, value.userId)) refuseMfaWrite();
      await commitMfaPhase(storage, [
        mfaAuditClaim(db, { operation: value, action: activate ? "accounts_mfa_enrolled" : value.enabled ? "accounts_mfa_replacement_started" : "accounts_mfa_setup_restarted" }),
        db.updateTable("user").set({ twoFactorEnabled: Number(activate), auth_revision: value.revision + 1,
          updatedAt: new Date().toISOString() }).where("id", "=", value.userId).where(mfaPhaseClaim(db, value)).compile(),
        activate ? db.updateTable("twoFactor").set({ verified: 1 }).where("id", "=", value.factor.id).where(mfaPhaseClaim(db, value)).compile()
          : db.deleteFrom("twoFactor").where("id", "=", value.factor.id).where(mfaPhaseClaim(db, value)).compile(),
        ...mfaRevocations(db, value),
      ]);
      value.revision += 1;
      value.phase = activate ? "activated" : "disabled";
      return await original.findOne({ model: "user", where: [{ field: "id", value: value.userId }] });
    }
    if (input.model === "twoFactor") {
      if (!value || !value.factor) refuseMfaWrite();
      if (input.update.verified === true && value.kind === "activate" && value.phase === "activated") {
        if (Object.keys(input.update).length !== 1 || !matchesId(input.where, value.factor.id)) refuseMfaWrite();
        await assertMfaSource(db, value);
      } else if ("backupCodes" in input.update) {
        if (value.kind !== "backups" || Object.keys(input.update).length !== 1
          || typeof input.update.backupCodes !== "string" || !matchesId(input.where, value.factor.id)) refuseMfaWrite();
        await commitMfaPhase(storage, [
          mfaAuditClaim(db, { operation: value, action: "accounts_mfa_backup_codes_replaced" }),
          guardedFactorUpdate(db, { value, where: [...input.where, { field: "backupCodes", value: value.factor.backupCodes }] })
            .set({ backupCodes: input.update.backupCodes }).where(mfaPhaseClaim(db, value)).compile(),
        ]);
      } else {
        if (value.kind !== "verify" || input.update.failedVerificationCount !== 0 || input.update.lockedUntil !== null
          || Object.keys(input.update).some((key) => !["failedVerificationCount", "lockedUntil"].includes(key))) refuseMfaWrite();
        const row = await guardedFactorUpdate(db, { value, where: input.where }).set({ failedVerificationCount: 0, lockedUntil: null })
          .returning("id").executeTakeFirst();
        if (!row) refuseMfaWrite();
      }
      return await original.findOne({ model: "twoFactor", where: [{ field: "id", value: value.factor.id }] });
    }
    if (isMfaWrite(input.model, input.update)) refuseMfaWrite();
    return await original.update(input);
  };
  adapter.updateMany = async (input) => {
    if (isMfaWrite(input.model, input.update)) refuseMfaWrite();
    return await original.updateMany(input);
  };
  adapter.incrementOne = async (input) => {
    if (input.model === "twoFactor") {
      const value = await readMfaOperation();
      if (!value || value.kind !== "verify" || !value.factor
        || Object.keys(input.increment).some((key) => key !== "failedVerificationCount")
        || "failedVerificationCount" in input.increment && input.increment.failedVerificationCount !== 1
        || Object.keys(input.set ?? {}).some((key) => !["backupCodes", "lockedUntil", "failedVerificationCount"].includes(key))
        || input.set && "failedVerificationCount" in input.set && input.set.failedVerificationCount !== 0) refuseMfaWrite();
      const values = nativeFactorValues(input.set ?? {});
      const where = "backupCodes" in values ? [...input.where, { field: "backupCodes", value: value.factor.backupCodes }] : input.where;
      const row = await guardedFactorUpdate(db, { value, where }).set((eb) => ({ ...values,
        ...("failedVerificationCount" in input.increment ? {
          failedVerificationCount: eb(eb.fn.coalesce("failedVerificationCount", eb.val(0)), "+", 1),
        } : {}),
      })).returning("id").executeTakeFirst();
      return row ? await original.findOne({ model: "twoFactor", where: [{ field: "id", value: row.id }] }) : null;
    }
    if (isMfaWrite(input.model, input.increment) || isMfaWrite(input.model, input.set ?? {})) refuseMfaWrite();
    return await original.incrementOne(input);
  };
  adapter.delete = async (input) => {
    if (input.model === "twoFactor") {
      const value = await readMfaOperation(), where = input.where;
      if (!value || value.kind !== "disable" || value.phase !== "disabled" || where.length !== 1 || !where[0]
        || where[0].operator && where[0].operator !== "eq" || where[0].connector === "OR"
        || !["id", "userId"].includes(where[0].field)
        || where[0].value !== (where[0].field === "id" ? value.factor?.id : value.userId)) refuseMfaWrite();
      await assertMfaSource(db, value);
      return;
    }
    return await original.delete(input);
  };
  adapter.deleteMany = async (input) => {
    if (input.model === "twoFactor") refuseMfaWrite();
    const value = await readMfaOperation();
    if (input.model === "session" && value?.kind === "password") {
      const where = input.where;
      if (value.phase !== "running" || !value.actor || !value.account || typeof value.account.password !== "string"
        || where.length !== 1 || where[0]?.field !== "userId" || where[0].value !== value.userId
        || where[0].operator && where[0].operator !== "eq" || where[0].connector === "OR") refuseMfaWrite();
      const removed = await db.deleteFrom("session").where("userId", "=", value.userId)
        .where((eb) => eb.exists(currentMfaSource(db, value).select("id"))).returning("id").execute();
      if (!removed.some((row) => row.id === value.actor?.id)) refuseMfaWrite();
      value.phase = "sessions_ended";
      return removed.length;
    }
    return await original.deleteMany(input);
  };
  adapter.consumeOne = async <T>(input: Parameters<DBAdapter["consumeOne"]>[0]): Promise<T | null> => {
    if (input.model === "twoFactor") refuseMfaWrite();
    const result = await original.consumeOne<T>(input);
    const value = await readMfaOperation(), challenge = value?.challenge;
    if (input.model === "verification" && result && typeof result === "object" && "id" in result
      && value?.kind === "verify" && challenge && result.id === challenge.id) {
      if (!("identifier" in result) || result.identifier !== challenge.identifier || !("value" in result) || result.value !== value.userId
        || !("authRevision" in result) || result.authRevision !== value.revision || !("expiresAt" in result)
        || !(result.expiresAt instanceof Date) || result.expiresAt.getTime() <= Date.now()) refuseMfaWrite();
      // Only the native atomic consumption result can establish this; cleanup deletion cannot.
      value.consumed = true;
    }
    return result;
  };
  // Preserve the object registered by the native factory. Its sequential
  // transaction callbacks close over this object and must see these guards too.
  return adapter;
}

function isMfaWrite(model: string, values: Record<string, unknown>): boolean {
  return model === "twoFactor" || model === "account" && "password" in values || ["user", "session", "verification"].includes(model)
    && (hasPhysicalFields(values) || ["authRevision", "mfaVerifiedAt", "twoFactorEnabled"].some((field) => field in values));
}

function hasPhysicalFields(values: Record<string, unknown>): boolean {
  return "auth_revision" in values || "mfa_verified_at" in values;
}

function hasInitialUserMetadata(data: Record<string, unknown>): boolean {
  return (data.authRevision === undefined || data.authRevision === 0)
    && (data.twoFactorEnabled === undefined || data.twoFactorEnabled === false)
    && !hasPhysicalFields(data) && !("mfaVerifiedAt" in data);
}

function hasUnrelatedVerificationMetadata(data: Record<string, unknown>): boolean {
  return (data.authRevision === undefined || data.authRevision === null) && !isMainMfaChallenge(data.identifier)
    && !hasPhysicalFields(data) && !("mfaVerifiedAt" in data) && !("twoFactorEnabled" in data);
}

function isMainMfaChallenge(identifier: unknown): boolean {
  return typeof identifier === "string" && identifier.startsWith("2fa-") && !identifier.startsWith("2fa-attempts-");
}

function matchesSessionSource(source: Exclude<AuthSource, { kind: "mfa" }>, data: Record<string, unknown>): boolean {
  return source.loginId === data.userId && !hasPhysicalFields(data) && !("twoFactorEnabled" in data)
    && (data.mfaVerifiedAt === undefined || data.mfaVerifiedAt === null)
    && (data.authRevision === undefined || data.authRevision === 0 || data.authRevision === source.revision);
}

function matchesId(where: Parameters<DBAdapter["update"]>[0]["where"], id: string): boolean {
  return where.length === 1 && where[0]?.field === "id" && where[0].value === id
    && (where[0].operator === undefined || where[0].operator === "eq") && where[0].connector !== "OR";
}
