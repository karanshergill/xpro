import { handleHubAuthRequest as handle } from "../../apps/hub/src/auth/oidc.server";
import type { HubRequestHandler } from "./sign-in";

// T018 supplies the real HTTP entry; this declaration supplies no implementation.
export const handleHubAuthRequest: HubRequestHandler = handle;
