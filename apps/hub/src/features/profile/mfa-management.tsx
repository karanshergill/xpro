import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@xpro/ui/button";
import { m } from "#paraglide/messages.js";
import { MfaForm } from "#features/mfa/mfa-form";
import { MfaAccessCheck } from "#features/mfa/access-check";
import { PrivateCodes } from "#features/mfa/private-codes";
import { clearMfaPrivateForms, useClearMfaOnLeave } from "#features/mfa/private-state";
import { generateBackups } from "#features/mfa/mfa.data";
import type { MfaFailure } from "#features/mfa/mfa";
import type { Profile } from "./profile";
import type { FormActions } from "./profile-form";

type Props = FormActions & { profile: Profile; isChecking: boolean; onSignIn(): void; onRefresh(): Promise<Profile | null> };

export function MfaManagement({ profile, isChecking, onSignIn, onRefresh, ...actions }: Props): React.JSX.Element {
  const [codes, setCodes] = useState<string[]>(), [isUncertain, setIsUncertain] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), success = useRef<HTMLHeadingElement>(null), generation = useRef(0);
  useClearMfaOnLeave(clearPrivate);
  useEffect(() => { if (codes) success.current?.focus({ preventScroll: true }); }, [codes]);
  function clearPrivate(): void { generation.current++; setCodes(undefined); clearMfaPrivateForms(); }
  function handleFailure(error: MfaFailure): void {
    setIsUncertain(!["core_invalid_input", "accounts_current_password_invalid", "core_mfa_recent_verification_required", "accounts_mfa_limited"].includes(error.code));
    actions.onFailure(error);
  }
  async function handleDismiss(): Promise<void> { clearPrivate(); requestAnimationFrame(() => heading.current?.focus()); }
  return <section className="space-y-5 rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="profile-mfa-title">
    <h2 ref={heading} id="profile-mfa-title" tabIndex={-1} className="text-xl font-semibold outline-none">{m.accounts_mfa_management_title()}</h2>
    <p className="text-sm leading-6">{m.accounts_mfa_status_enabled()}</p>
    {codes ? <div className="space-y-5"><h3 ref={success} tabIndex={-1} className="text-lg font-semibold outline-none">{m.accounts_mfa_backups_title()}</h3>
      <PrivateCodes codes={codes} disabled={actions.disabled} continueLabel={m.accounts_mfa_done()} onContinue={handleDismiss} /></div> : <>
      <p className="text-sm leading-6">{m.accounts_mfa_generate_warning()}</p>
      {profile.mfa === "recent_required" ? <MfaAccessCheck onSignIn={onSignIn} isChecking={isChecking} onCheck={() => { void onRefresh(); }} /> : null}
      {isUncertain ? <p role="alert" className="text-sm leading-6">{m.accounts_mfa_backups_uncertain()}</p> : null}
      <MfaForm kind="password" label={m.accounts_profile_current_password()} submitLabel={m.accounts_mfa_generate()} access={profile.mfa}
        disabled={actions.disabled || profile.mfa !== "ready"} onBusy={actions.onBusy} onFailure={handleFailure}
        onSubmit={async (password) => { setIsUncertain(false); return await generateBackups(password, actions.loginId); }}
        onCompleted={async (result) => {
          const submittedGeneration = generation.current;
          const refreshed = await onRefresh();
          if (submittedGeneration !== generation.current || !refreshed || refreshed.mfa === "unavailable") { clearPrivate(); return; }
          setCodes(result.backupCodes);
        }} />
      <a className={buttonVariants({ variant: "outline" })} href="/mfa?intent=replace" aria-disabled={actions.disabled || undefined}
        onClick={(event) => { if (actions.disabled) event.preventDefault(); }}>{m.accounts_mfa_replace()}</a>
      {profile.mfa !== "recent_required" ? <Button type="button" variant="outline" disabled={actions.disabled} onClick={() => { void onRefresh(); }}>{m.accounts_profile_access_check()}</Button> : null}
    </>}
  </section>;
}
