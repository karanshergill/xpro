// Root integration wiring calls the real shared access policy; no substitute validator.
export { validateHubAccess, validateHubLocalAccess } from "@xpro/accounts/server";
export { saveHub } from "../../apps/hub/src/db/hub-save.db.ts";
