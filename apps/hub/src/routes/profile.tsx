import { createFileRoute, redirect } from "@tanstack/react-router";
import cropCss from "react-image-crop/dist/ReactCrop.css?url";
import { m } from "#paraglide/messages.js";
import { loadProfile } from "#features/profile/profile.data";
import { ProfileError, ProfilePending, ProfileScreen } from "#features/profile/profile-screen";

export const Route = createFileRoute("/profile")({
  beforeLoad: async ({ abortController }) => {
    const page = await loadProfile({ signal: abortController.signal });
    if (page.status === "error" && page.error.code === "core_mfa_required") throw redirect({ href: "/mfa", reloadDocument: true });
    if (page.status === "error" && page.error.code === "core_unauthenticated") throw redirect({ href: "/sign-in", reloadDocument: true });
    if (page.status === "error" && page.error.code === "core_profile_incomplete") throw redirect({ href: "/complete-profile", reloadDocument: true });
    return { profilePage: page };
  },
  head: () => ({ meta: [{ title: m.accounts_profile_title() + " · " + m.core_app_name() }], links: [{ rel: "stylesheet", href: cropCss }] }),
  pendingComponent: ProfilePending,
  errorComponent: () => <ProfileError />,
  component: ProfilePage,
});

function ProfilePage(): React.JSX.Element {
  const page = Route.useRouteContext().profilePage;
  return page.status === "error" ? <ProfileError failure={page.error} /> : <ProfileScreen initial={page.profile} />;
}
