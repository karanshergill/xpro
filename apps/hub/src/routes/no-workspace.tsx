import { createFileRoute } from "@tanstack/react-router";
import { m } from "#paraglide/messages.js";
import { UnassignedScreen } from "#features/sign-in/sign-in-screen";

export const Route = createFileRoute("/no-workspace")({
  head: () => ({ meta: [{ title: m.accounts_sign_in_unassigned_title() + " · " + m.core_app_name() }] }),
  component: UnassignedScreen,
});
