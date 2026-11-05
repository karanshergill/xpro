import { createFileRoute } from "@tanstack/react-router";
import { m } from "#paraglide/messages.js";
import { loadSignInPage } from "#features/sign-in/sign-in.data";
import { SignInError, SignInPending, SignInScreen } from "#features/sign-in/sign-in-screen";

export const Route = createFileRoute("/sign-in")({
  beforeLoad: async ({ abortController }) => ({ signInPage: await loadSignInPage(abortController.signal) }),
  head: () => ({ meta: [{ title: m.accounts_sign_in_title() + " · " + m.core_app_name() }] }),
  pendingComponent: SignInPending,
  errorComponent: () => <SignInError />,
  component: SignIn,
});

function SignIn(): React.JSX.Element {
  const page = Route.useRouteContext().signInPage;
  return page.status === "error" ? <SignInError failure={page.error} /> : <SignInScreen siteKey={page.siteKey} />;
}
