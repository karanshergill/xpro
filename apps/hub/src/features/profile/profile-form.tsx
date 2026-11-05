import { useEffect, type ReactNode } from "react";
import { m } from "#paraglide/messages.js";
import { getFailureMessage, type ProfileFailure } from "./profile";

export type FormActions = { loginId: string; disabled: boolean; onBusy(isBusy: boolean): void; onFailure(error: ProfileFailure): void };

export function useUnsavedProfile(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
}

export function ProfileNotice({ failure, children }: { failure?: ProfileFailure; children?: ReactNode }): React.JSX.Element {
  return <><p>{children ?? (failure ? getFailureMessage(failure) : m.accounts_profile_errors())}</p>
    {failure?.requestId ? <p className="mt-2 break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}</>;
}
