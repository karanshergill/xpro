import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@xpro/ui/button";
import { m } from "#paraglide/messages.js";
import { getFailureMessage, type ManagementFailure } from "./management";

export function StmsShell({ children }: { children: ReactNode }): React.JSX.Element {
  return <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
    <nav aria-label={m.stms_logins_navigation()} className="mb-7 flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <a href="/stms/logins" className="inline-flex min-h-6 items-center underline underline-offset-4">{m.stms_logins_title()}</a>
      <a href="/stms/accounts" className="inline-flex min-h-6 items-center underline underline-offset-4">{m.stms_accounts_title()}</a>
      <a href="/create-login" className="inline-flex min-h-6 items-center underline underline-offset-4">{m.stms_logins_create()}</a>
      <a href="/profile" className="inline-flex min-h-6 items-center underline underline-offset-4">{m.stms_logins_profile()}</a>
    </nav>{children}</main>;
}

export function FailureMessage({ error }: { error: ManagementFailure }): React.JSX.Element {
  return <><p>{getFailureMessage(error)}</p>{error.requestId ? <p className="mt-2 break-all text-sm">{m.core_request_id({ requestId: error.requestId })}</p> : null}</>;
}

export function StmsError({ error }: { error?: ManagementFailure }): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null); useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <StmsShell><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.stms_logins_page_error()}</h1>
    <div role="alert" className="mt-4"><FailureMessage error={error ?? { code: "core_unexpected_error" }} /></div>
    <Button className="mt-5" type="button" onClick={() => location.reload()}>{m.core_retry()}</Button></StmsShell>;
}

export function StmsPending(): React.JSX.Element {
  return <StmsShell><h1 className="text-2xl font-semibold">{m.stms_logins_title()}</h1>
    <div aria-hidden="true" className="mt-6 h-96 animate-pulse rounded-xl bg-muted" /><p role="status" className="sr-only">{m.core_loading()}</p></StmsShell>;
}
