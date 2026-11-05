import { createFileRoute, redirect, stripSearchParams } from "@tanstack/react-router";
import { m } from "#paraglide/messages.js";
import { defaultLoginSearch, readLoginSearch } from "#features/stms/management";
import { loadLogin } from "#features/stms/management.data";
import { LoginDetail } from "#features/stms/login-detail";
import { StmsError, StmsPending } from "#features/stms/management-ui";

export const Route = createFileRoute("/stms/logins/$loginId")({
  validateSearch: readLoginSearch,
  search: { middlewares: [stripSearchParams(defaultLoginSearch)] },
  loader: async ({ params, abortController }) => {
    const page = await loadLogin(params.loginId, { signal: abortController.signal });
    if (page.status === "error" && page.error.code === "core_mfa_required") throw redirect({ href: "/mfa", reloadDocument: true });
    if (page.status === "error" && page.error.code === "core_unauthenticated") throw redirect({ href: "/sign-in", reloadDocument: true });
    if (page.status === "error" && page.error.code === "core_profile_incomplete") throw redirect({ href: "/complete-profile", reloadDocument: true });
    return page;
  },
  head: () => ({ meta: [{ title: m.stms_logins_detail_title() + " · " + m.core_app_name() }] }),
  pendingComponent: StmsPending, errorComponent: () => <StmsError />, component: Login,
});

function Login(): React.JSX.Element {
  const page = Route.useLoaderData(), search = Route.useSearch();
  return page.status === "error" ? <StmsError error={page.error} /> : <LoginDetail initial={page.value} pageLoginId={page.pageLoginId} search={search} />;
}
