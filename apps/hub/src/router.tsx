import "./functions/creation-page.functions";
import "./functions/creation-workspaces.functions";
import "./functions/sign-in-page.functions";
import "./functions/mfa-page.functions";
import "./functions/mfa.functions";
import "./functions/complete-profile-page.functions";
import "./functions/login-identifiers.functions";
import "./functions/login-status.functions";
import "./functions/logins.functions";
import { createRouter, type Router } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "./functions/complete-first-sign-in.functions";
import "./functions/create-login.functions";
import "#functions/reset-password.functions";
import "#functions/profile.functions";
import "#functions/picture.functions";
import "#functions/management-operations.functions";
import "#functions/accounts.functions";

export function getRouter(): Router<typeof routeTree> {
  let isInitialRender = true;
  return createRouter({ routeTree, scrollRestoration: () => {
    // Preserve document scrolling during hydration; restore later client navigations.
    const shouldRestore = !isInitialRender;
    isInitialRender = false;
    return shouldRestore;
  } });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
import "./functions/profile-page.functions";
