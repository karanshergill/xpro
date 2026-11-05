import { createFileRoute, redirect, stripSearchParams } from "@tanstack/react-router";
import { m } from "#paraglide/messages.js";
import { defaultLoginSearch, readLoginSearch } from "#features/stms/management";
import { loadLogins } from "#features/stms/management.data";
import { LoginList } from "#features/stms/login-list";
import { StmsError, StmsPending } from "#features/stms/management-ui";

export const Route = createFileRoute("/stms/logins/")({
  validateSearch: readLoginSearch,
  search: { middlewares: [stripSearchParams(defaultLoginSearch)] },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, abortController }) => {
    const page = await loadLogins(deps, abortController.signal);
    if (page.status === "error" && page.error.code === "core_mfa_required") throw redirect({ href: "/mfa", reloadDocument: true });
    if (page.status === "error" && page.error.code === "core_unauthenticated") throw redirect({ href: "/sign-in", reloadDocument: true });
    if (page.status === "error" && page.error.code === "core_profile_incomplete") throw redirect({ href: "/complete-profile", reloadDocument: true });
    return page;
  },
  head: () => ({ meta: [{ title: m.stms_logins_title() + " · " + m.core_app_name() }] }),
  pendingComponent: StmsPending, errorComponent: () => <StmsError />, component: Logins,
});

function Logins(): React.JSX.Element {
  const page = Route.useLoaderData(), search = Route.useSearch();
  return page.status === "error" ? <StmsError error={page.error} /> : <LoginList page={page.value} search={search} />;
}
