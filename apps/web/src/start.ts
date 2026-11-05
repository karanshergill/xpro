import { createStart } from "@tanstack/react-start";
import { fetchWorkspace } from "#auth/session-fetch";

export const startInstance = createStart(() => ({ serverFns: { fetch: fetchWorkspace } }));
