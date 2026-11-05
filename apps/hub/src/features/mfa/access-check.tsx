import { Button, buttonVariants } from "@xpro/ui/button";
import { m } from "#paraglide/messages.js";

export function MfaAccessCheck({ isChecking, onCheck, onSignIn }: { isChecking: boolean; onCheck(): void; onSignIn(): void }): React.JSX.Element {
  return <div className="space-y-3 rounded-lg border border-border p-4">
    <p className="text-sm leading-6">{m.accounts_mfa_recent_required()}</p>
    <div className="flex flex-wrap gap-3">
      <a className={buttonVariants({ variant: "outline" })} href="/sign-in" onClick={onSignIn} target="_blank" rel="noopener noreferrer">{m.accounts_profile_sign_in_tab()}</a>
      <Button type="button" variant="outline" disabled={isChecking} onClick={onCheck}>{isChecking ? m.core_loading() : m.accounts_profile_access_check()}</Button>
    </div>
  </div>;
}
