import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Button, buttonVariants } from "@xpro/ui/button";
import { m } from "#paraglide/messages.js";

export const Route = createFileRoute("/session-return")({
  head: () => ({ meta: [{ title: m.core_session_return_title() + " · " + m.core_app_name() }] }),
  component: SessionReturn,
});

function SessionReturn(): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <main className="mx-auto w-full max-w-lg px-4 py-10">
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.core_session_return_title()}</h1>
    <p className="mt-4 text-sm leading-6 text-muted-foreground">{m.core_session_return_message()}</p>
    <div className="mt-6 flex flex-wrap gap-3">
      <Button onClick={() => window.close()}>{m.core_session_close_tab()}</Button>
      <a className={buttonVariants({ variant: "outline" })} href="/">{m.core_session_home()}</a>
    </div>
  </main>;
}
