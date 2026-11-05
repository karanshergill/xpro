import { useEffect } from "react";
import { Button } from "@xpro/ui/button";
import { m } from "#paraglide/messages.js";
import { isUncertainFailure, type ManagementFailure } from "./management";

export type ManagementActions = {
  pageLoginId: string; disabled: boolean; onBusy(isBusy: boolean): void; onFailure(error: ManagementFailure): void;
  onSaved(): Promise<boolean>; onRefresh(): Promise<boolean>;
};

export function useUnsavedChanges(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
}

export function CheckSavedChange({ error, disabled, onRefresh }: { error: ManagementFailure; disabled: boolean; onRefresh(): Promise<boolean> }): React.JSX.Element | null {
  const isUncertain = isUncertainFailure(error);
  if (!isUncertain && error.code !== "stms_login_state_conflict") return null;
  return <div className="mt-3 space-y-3">{isUncertain ? <p>{m.stms_logins_unknown()}</p> : null}
    <Button type="button" variant="outline" disabled={disabled} onClick={async () => { await onRefresh(); }}>{m.stms_logins_check_saved()}</Button></div>;
}
