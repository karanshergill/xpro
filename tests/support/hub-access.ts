// Root integration wiring calls the real Hub code; no substitute validator.
export { validateHubAccess, validateHubLocalAccess } from "../../apps/hub/src/auth/validate-access.server.ts";
export { saveHub } from "../../apps/hub/src/db/hub-save.db.ts";
