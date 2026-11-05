import { resetPassword } from "@xpro/stms/server";
import { createErrorResponse, requestIdHeader } from "@xpro/core/server";
import type { HubAuthSettings } from "#auth/auth.server.ts";
import { withMasterRequest } from "./master-request.server";

export async function handleResetPassword(input: unknown, services: { request: Request; settings: HubAuthSettings }): Promise<Response> {
  return await withMasterRequest(services, async ({ auth, access, context, settings }) => {
    const result = await resetPassword(input, { database: settings.database, access, context,
      async hashPassword(password) { return await (await auth.$context).password.hash(password); } });
    if (result.isErr) {
      return result.error.code === "stms_login_not_found" ? Response.json({ code: result.error.code,
        message: "This login could not be found.", requestId: context.requestId }, {
        status: 404, headers: { [requestIdHeader]: context.requestId, "cache-control": "no-store" },
      }) : createErrorResponse(result.error, context);
    }
    return Response.json({ loginId: result.value.loginId }, {
      headers: { [requestIdHeader]: context.requestId, "cache-control": "no-store" },
    });
  });
}
