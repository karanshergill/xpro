import { useEffect, useRef } from "react";
import { Button } from "@xpro/ui/button";
import { m } from "#paraglide/messages.js";
import type { SessionFailure } from "./session";

export function WorkspacePageError({ failure }: { failure?: SessionFailure }): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <main className="mx-auto w-full max-w-lg px-4 py-10">
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.core_error_title()}</h1>
    <p role="alert" className="mt-4 text-sm leading-6">{m.core_error_message()}</p>
    {failure?.requestId ? <p className="mt-3 break-all text-sm">{m.core_request_id({ requestId: failure.requestId })}</p> : null}
    <div className="mt-6"><Button onClick={() => window.location.reload()}>{m.core_retry()}</Button></div>
  </main>;
}

export function WorkspacePagePending(): React.JSX.Element {
  return <main className="mx-auto w-full max-w-lg px-4 py-10">
    <h1 className="text-2xl font-semibold">{m.core_app_name()}</h1>
    <p role="status" className="mt-4">{m.core_loading()}</p>
  </main>;
}
