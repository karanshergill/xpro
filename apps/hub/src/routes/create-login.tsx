import { createFileRoute, redirect } from "@tanstack/react-router";
import { m } from "#paraglide/messages.js";
import { loadCreationPage } from "#features/create-login/creation.data";
import { CreateLoginScreen, CreationError, CreationPending } from "#features/create-login/create-login-screen";

export const Route = createFileRoute("/create-login")({
  beforeLoad: async ({ abortController }) => {
    const page = await loadCreationPage(abortController.signal);
    if (page.status === "error" && page.error.code === "core_mfa_required") throw redirect({ href: "/mfa", reloadDocument: true });
    if (page.status === "error" && page.error.code === "core_unauthenticated") throw redirect({ href: "/sign-in", reloadDocument: true });
    if (page.status === "error" && page.error.code === "core_profile_incomplete") throw redirect({ href: "/complete-profile", reloadDocument: true });
    return { creationPage: page };
  },
  head: () => ({ meta: [{ title: m.accounts_create_login_title() + " · " + m.core_app_name() }] }),
  pendingComponent: CreationPending,
  errorComponent: () => <CreationError />,
  component: CreateLogin,
});

function CreateLogin(): React.JSX.Element {
  const page = Route.useRouteContext().creationPage;
  return page.status === "ready" ? <CreateLoginScreen page={page.data} /> : <CreationError failure={page.error} />;
}
