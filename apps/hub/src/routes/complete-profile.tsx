import { createFileRoute, redirect } from "@tanstack/react-router";
import { readPageSearch } from "#page-search";
import { m } from "#paraglide/messages.js";
import { loadCompletionPage } from "#features/complete-profile/complete-profile.data";
import { CompletionError, CompletionPending, CompletionScreen } from "#features/complete-profile/complete-profile-screen";

export const Route = createFileRoute("/complete-profile")({
  beforeLoad: async ({ abortController }) => {
    const page = await loadCompletionPage(abortController.signal);
    if (page.status === "error" && page.error.code === "core_mfa_required") {
      throw redirect({ href: "/mfa" + readPageSearch(), reloadDocument: true });
    }
    if (page.status === "error" && page.error.code === "core_unauthenticated") {
      throw redirect({ href: "/sign-in" + readPageSearch(), reloadDocument: true });
    }
    if (page.status === "ready" && !page.fields.length && !readPageSearch()) {
      throw redirect({ href: "/auth/destination", reloadDocument: true });
    }
    return { completionPage: page };
  },
  head: () => ({ meta: [{ title: m.accounts_complete_profile_title() + " · " + m.core_app_name() }] }),
  pendingComponent: CompletionPending,
  errorComponent: () => <CompletionError />,
  component: CompleteProfile,
});

function CompleteProfile(): React.JSX.Element {
  const page = Route.useRouteContext().completionPage;
  return page.status === "error" ? <CompletionError failure={page.error} /> : <CompletionScreen initialFields={page.fields} />;
}
