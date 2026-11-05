import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@xpro/ui/alert-dialog";
import { Button, buttonVariants } from "@xpro/ui/button";
import { m } from "#paraglide/messages.js";
import { loadWorkspacePage } from "./session.data";
import { getSessionMessage, getSessionTitle } from "./messages";
import { isSessionFailure, readSessionFailure, sessionFailureEventName, type SessionFailure } from "./session";

type PendingCheck = { controller: AbortController; startedAt: number };

export function SessionExpiry({ loginId, children }: { loginId: string; children: ReactNode }): React.JSX.Element {
  // This is the document's original identity, never a client authorization cache.
  const originalLoginId = useRef(loginId), pending = useRef<PendingCheck | undefined>(undefined);
  const lastVerifiedAt = useRef(0), failureRef = useRef<SessionFailure | undefined>(undefined);
  const [failure, setFailure] = useState<SessionFailure>(), [isChecking, setIsChecking] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  function block(value: SessionFailure): void { failureRef.current = value; setFailure(value); }

  async function checkAccess(): Promise<boolean> {
    pending.current?.controller.abort();
    const check = { controller: new AbortController(), startedAt: performance.now() };
    pending.current = check;
    setIsChecking(true);
    try {
      const result = await loadWorkspacePage(check.controller.signal);
      if (check.controller.signal.aborted || pending.current !== check) return false;
      if (result.status === "error") { block(result.error); return false; }
      if (result.loginId !== originalLoginId.current) { block({ code: "core_identity_changed" }); return false; }
      lastVerifiedAt.current = check.startedAt;
      failureRef.current = undefined;
      setFailure(undefined);
      return true;
    } catch {
      if (!check.controller.signal.aborted) block({ code: "core_unexpected_error" });
      return false;
    } finally {
      if (pending.current === check) { pending.current = undefined; setIsChecking(false); }
    }
  }

  useBlocker({ enableBeforeUnload: false, shouldBlockFn: async ({ current, next }) => {
    if (failureRef.current) return true;
    if (current.pathname === next.pathname && JSON.stringify(current.search) === JSON.stringify(next.search)) return false;
    // shortcut: current workspace routes have no protected client loaders.
    // Before adding them, bind their reads to this guard so revocation between
    // this check and a loader cannot replace a mounted draft with an error page.
    return !await checkAccess();
  } });

  useEffect(() => {
    function handleFailure(event: Event): void {
      if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== "object") return;
      const value: unknown = event.detail;
      if (!value || typeof value !== "object" || !("startedAt" in value) || typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt)) return;
      const failure = readSessionFailure(value);
      if (!isSessionFailure(failure.code) || value.startedAt < lastVerifiedAt.current) return;
      if (pending.current && value.startedAt >= pending.current.startedAt) pending.current.controller.abort();
      block(failure);
    }
    function handleFocus(): void { if (failureRef.current) void checkAccess(); }
    window.addEventListener(sessionFailureEventName, handleFailure);
    window.addEventListener("focus", handleFocus);
    return () => {
      pending.current?.controller.abort();
      window.removeEventListener(sessionFailureEventName, handleFailure);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const canSignIn = failure?.code === "core_unauthenticated" || failure?.code === "core_profile_incomplete";
  return <>
    <div id="workspace-page" data-login-id={originalLoginId.current} inert={Boolean(failure)}
      aria-hidden={failure ? true : undefined} aria-busy={isChecking} className={failure ? "invisible" : undefined}>{children}</div>
    <span role="status" className="sr-only">{isChecking ? m.core_session_checking() : ""}</span>
    <AlertDialog open={Boolean(failure)}>
      <AlertDialogContent initialFocus={heading}>
        <AlertDialogTitle ref={heading} tabIndex={-1}>{getSessionTitle(failure ?? { code: "core_unauthenticated" })}</AlertDialogTitle>
        <AlertDialogDescription>{getSessionMessage(failure ?? { code: "core_unauthenticated" })}</AlertDialogDescription>
        {failure?.requestId ? <p className="break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
        <div className="flex flex-wrap gap-3">
          {canSignIn ? <a className={buttonVariants()} href="/auth/start?returnTo=%2Fsession-return" target="_blank" rel="noopener noreferrer">{m.core_session_sign_in()}</a> : null}
          <Button variant="outline" disabled={isChecking} onClick={async () => { await checkAccess(); }}>
            {isChecking ? <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-e-transparent" /> : null}
            {isChecking ? m.core_session_checking() : canSignIn ? m.core_session_continue() : m.core_retry()}
          </Button>
          {failure?.code === "core_identity_changed" || failure?.code === "core_forbidden" || failure?.code === "core_login_inactive"
            ? <Button variant="outline" onClick={() => window.location.reload()}>{m.core_session_reload()}</Button> : null}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
