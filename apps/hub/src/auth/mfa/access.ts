import { parseUtcTimestamp, type MfaAccessState } from "@xpro/core/server";

export type MfaAccessFacts = {
  isMaster: boolean; userAuthRevision: number; sessionAuthRevision: number; twoFactorEnabled: number | null;
  factorId: string | null; factorVerified: number | null; mfaVerifiedAt: string | null; now: number;
};

export function getMfaAccessState(facts: MfaAccessFacts): MfaAccessState | null {
  if (!Number.isSafeInteger(facts.userAuthRevision) || facts.userAuthRevision < 0
    || !Number.isSafeInteger(facts.sessionAuthRevision) || facts.sessionAuthRevision < 0
    || facts.sessionAuthRevision !== facts.userAuthRevision) return null;
  if (!facts.isMaster) return { status: "not_required" };
  if (facts.twoFactorEnabled === 0) {
    const hasNoFactor = facts.factorId === null && facts.factorVerified === null;
    const hasPendingFactor = facts.factorId !== null && facts.factorVerified === 0;
    return facts.mfaVerifiedAt === null && (hasNoFactor || hasPendingFactor) ? { status: "enrollment_required" } : null;
  }
  if (facts.twoFactorEnabled !== 1 || facts.factorId === null || facts.factorVerified !== 1) return null;
  if (facts.mfaVerifiedAt === null) return { status: "sign_in_required" };
  const verifiedAt = parseUtcTimestamp(facts.mfaVerifiedAt);
  return verifiedAt !== null && verifiedAt <= facts.now ? { status: "verified", verifiedAt: facts.mfaVerifiedAt } : null;
}
