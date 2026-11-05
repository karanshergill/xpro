import { createFileRoute, redirect } from "@tanstack/react-router";
import { readPageSearch } from "#page-search";
import { m } from "#paraglide/messages.js";
import { loadMfaPage } from "#features/mfa/mfa.data";
import { MfaError, MfaPending, MfaScreen } from "#features/mfa/mfa-screen";

export const Route = createFileRoute("/mfa")({
  beforeLoad: async ({ abortController }) => {
    const page = await loadMfaPage({ signal: abortController.signal });
    if (page.status === "error" && page.error.code === "core_unauthenticated") throw redirect({ href: "/sign-in" + readPageSearch(), reloadDocument: true });
    return { mfaPage: page };
  },
  head: () => ({ meta: [{ title: m.accounts_mfa_verify_title() + " · " + m.core_app_name() }] }),
  pendingComponent: MfaPending,
  errorComponent: () => <MfaError />,
  component: Mfa,
});

function Mfa(): React.JSX.Element {
  const page = Route.useRouteContext().mfaPage;
  return page.status === "error" ? <MfaError failure={page.error} /> : <MfaScreen page={page} />;
}
