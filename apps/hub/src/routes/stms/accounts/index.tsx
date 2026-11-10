import { createFileRoute, redirect, stripSearchParams } from "@tanstack/react-router";
import { m } from "#paraglide/messages.js";
import { readLoginSearch } from "#features/stms/management";
import { AccountError, AccountListPending } from "#features/stms/accounts/account-ui";
import { defaultAccountSearch, loadAccounts } from "#features/stms/accounts/accounts.data";
import { AccountList } from "#features/stms/accounts/account-list";

export const Route = createFileRoute("/stms/accounts/")({
  validateSearch: readLoginSearch, search: { middlewares: [stripSearchParams(defaultAccountSearch)] }, loaderDeps: ({ search }) => search,
  loader: async ({ deps, abortController }) => {
    const page = await loadAccounts(deps, abortController.signal);
    if (page.status === "error" && page.error.code === "core_mfa_required") throw redirect({ href: "/mfa", reloadDocument: true });
    if (page.status === "error" && page.error.code === "core_unauthenticated") throw redirect({ href: "/sign-in", reloadDocument: true });
    if (page.status === "error" && page.error.code === "core_profile_incomplete") throw redirect({ href: "/complete-profile", reloadDocument: true });
    return page;
  },
  head: () => ({ meta: [{ title: m.stms_accounts_title() + " · " + m.core_app_name() }] }),
  pendingComponent: AccountListPending, errorComponent: () => <AccountError />, component: Accounts,
});
function Accounts(): React.JSX.Element {
  const page = Route.useLoaderData(), search = Route.useSearch();
  return page.status === "error" ? <AccountError error={page.error} /> : <AccountList page={page.value} search={search} />;
}
