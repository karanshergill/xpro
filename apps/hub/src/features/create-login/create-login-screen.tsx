import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@xpro/ui/button";
import { m } from "#paraglide/messages.js";
import { CreateLoginForm } from "./create-login-form";
import { getCreationFailureMessage, type CreationFailure, type CreationPageData } from "./creation";

export function CreateLoginScreen({ page }: { page: CreationPageData }): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <CreationShell><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.accounts_create_login_title()}</h1>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">{m.accounts_create_login_intro()}</p>
    <div className="mt-7"><CreateLoginForm page={page} /></div></CreationShell>;
}

export function CreationError({ failure }: { failure?: CreationFailure }): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <CreationShell><h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.accounts_create_login_page_error()}</h1>
    <p role="alert" className="mt-4">{failure ? getCreationFailureMessage(failure, m.core_error_message()) : m.core_error_message()}</p>
    {failure?.requestId ? <p className="mt-3 break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
    <div className="mt-6"><Button type="button" onClick={() => location.reload()}>{m.core_retry()}</Button></div></CreationShell>;
}

export function CreationPending(): React.JSX.Element {
  return <CreationShell><h1 className="text-2xl font-semibold">{m.accounts_create_login_title()}</h1>
    <p role="status" className="mt-4">{m.core_loading()}</p></CreationShell>;
}

function CreationShell({ children }: { children: ReactNode }): React.JSX.Element {
  return <main className="mx-auto w-full max-w-xl px-4 py-8 sm:py-12"><div className="rounded-2xl border border-border bg-card p-5 sm:p-8">{children}</div></main>;
}
