import { createFileRoute, redirect, stripSearchParams } from "@tanstack/react-router";
import { m } from "#paraglide/messages.js";
import { readLoginSearch } from "#features/stms/management";
import { AccountError, AccountDetailPending } from "#features/stms/accounts/account-ui";
import { defaultAccountSearch, loadAccount } from "#features/stms/accounts/accounts.data";
import { AccountDetail } from "#features/stms/accounts/account-detail";

export const Route = createFileRoute("/stms/accounts/$accountId")({
  validateSearch: readLoginSearch, search: { middlewares: [stripSearchParams(defaultAccountSearch)] },
  loader: async ({ params, abortController }) => {
    const page = await loadAccount(params.accountId, { signal: abortController.signal });
    if (page.status === "error" && page.error.code === "core_mfa_required") throw redirect({ href: "/mfa", reloadDocument: true });
    if (page.status === "error" && page.error.code === "core_unauthenticated") throw redirect({ href: "/sign-in", reloadDocument: true });
    if (page.status === "error" && page.error.code === "core_profile_incomplete") throw redirect({ href: "/complete-profile", reloadDocument: true });
    return page;
  },
  head: () => ({ meta: [{ title: m.stms_accounts_detail_title() + " · " + m.core_app_name() }] }),
  pendingComponent: AccountDetailPending, errorComponent: () => <AccountError />, component: Account,
});
function Account(): React.JSX.Element {
  const page = Route.useLoaderData(), search = Route.useSearch();
  return page.status === "error" ? <AccountError error={page.error} /> : <AccountDetail initial={page.value} pageLoginId={page.pageLoginId} search={search} />;
}
