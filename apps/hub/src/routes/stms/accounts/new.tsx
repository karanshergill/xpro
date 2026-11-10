import { createFileRoute, redirect } from "@tanstack/react-router";
import { m } from "#paraglide/messages.js";
import { loadHolders } from "#features/stms/accounts/accounts.data";
import { AccountCreate } from "#features/stms/accounts/account-create";
import { AccountError, AccountCreatePending } from "#features/stms/accounts/account-ui";

export const Route = createFileRoute("/stms/accounts/new")({
  loader: async ({ abortController }) => {
    const page = await loadHolders({ query: "", offset: 0 }, { signal: abortController.signal });
    if (page.status === "error" && page.error.code === "core_mfa_required") throw redirect({ href: "/mfa", reloadDocument: true });
    if (page.status === "error" && page.error.code === "core_unauthenticated") throw redirect({ href: "/sign-in", reloadDocument: true });
    if (page.status === "error" && page.error.code === "core_profile_incomplete") throw redirect({ href: "/complete-profile", reloadDocument: true });
    return page;
  },
  head: () => ({ meta: [{ title: m.stms_accounts_create_title() + " · " + m.core_app_name() }] }),
  pendingComponent: AccountCreatePending, errorComponent: () => <AccountError />, component: NewAccount,
});
function NewAccount(): React.JSX.Element {
  const page = Route.useLoaderData();
  return page.status === "error" ? <AccountError error={page.error} /> : <AccountCreate initial={page.value} pageLoginId={page.pageLoginId} />;
}
