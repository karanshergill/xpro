import type { ResetFixture } from "./reset-password";

type TokenRow = { id: string; userId: string | null; sessionId: string | null; revoked: string | null };

export async function readResetTokens(fixture: ResetFixture): Promise<{ access: TokenRow[]; refresh: TokenRow[] }> {
  const db = fixture.signIn.identities.db.withoutPlugins().withTables<{ oauthAccessToken: TokenRow; oauthRefreshToken: TokenRow }>();
  const [access, refresh] = await Promise.all([
    db.selectFrom("oauthAccessToken").select(["id", "userId", "sessionId", "revoked"]).orderBy("id").execute(),
    db.selectFrom("oauthRefreshToken").select(["id", "userId", "sessionId", "revoked"]).orderBy("id").execute(),
  ]);
  return { access, refresh };
}
