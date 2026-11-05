import { useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { m } from "#paraglide/messages.js";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: m.accounts_account_title() + " · " + m.core_app_name() }] }),
  component: AccountPage,
});

function AccountPage(): React.JSX.Element {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <main className="mx-auto w-full max-w-2xl px-4 py-10">
    <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">{m.accounts_account_title()}</h1>
  </main>;
}
