import { firstSignInEntries } from "@xpro/accounts";
import { completeFirstSignIn, validateHubLocalAccess, type FirstSignInError } from "@xpro/accounts/server";
import {
  createAccessRequest, createErrorResponse, createRequestContext, parseInput, reportUnexpectedError,
  requestIdHeader, type RequestContext,
} from "@xpro/core/server";
import { createHubAuth, type HubAuthSettings } from "#auth/auth.server.ts";

const usernameErrors = {
  accounts_username_invalid: { status: 400, message: "Use 4–8 lowercase characters, starting with a letter; letters, digits, dots, dashes and underscores are allowed." },
  accounts_username_taken: { status: 409, message: "This username is already taken." },
  accounts_username_reserved: { status: 409, message: "This username is reserved." },
  accounts_username_confirmation_required: { status: 400, message: "Confirm your username before continuing." },
  accounts_username_locked: { status: 409, message: "Your username can't be changed here." },
} as const;

type ParsedFirstSignIn = ReturnType<typeof parseInput<typeof firstSignInEntries>>;

export function validateFirstSignIn(input: unknown): ReturnType<ParsedFirstSignIn["toJSON"]> {
  // A standard-schema exception serializes validator issues, which can include input.
  return parseInput(input, firstSignInEntries).toJSON();
}

export async function handleFirstSignIn(
  input: ReturnType<typeof validateFirstSignIn>,
  services: { request: Request; settings: HubAuthSettings },
): Promise<Response> {
  const context = createRequestContext();
  if (input.variant === "Err") return createErrorResponse(input.error, context);
  let hasReportedError = false;
  const reportError = (): Response => {
    // Native schema, logger and endpoint hooks can report the same request failure.
    if (hasReportedError) return createErrorResponse({ code: "core_unexpected_error" }, context);
    hasReportedError = true;
    return reportUnexpectedError(context, { app: "hub", operation: "accounts_first_sign_in_request" });
  };
  try {
    const { settings, request } = services;
    const auth = await createHubAuth({ ...settings, requestContext: context, onUnexpectedError: reportError });
    const signedIn = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
    const access = await createAccessRequest({ app: "hub",
      session: signedIn ? { loginId: signedIn.user.id, hubSessionId: signedIn.session.id } : null,
      workspaceId: null, context,
      hub: { async validateAccess(value) { return await validateHubLocalAccess(settings.database, value); } },
    });
    const result = await completeFirstSignIn(input.value, { database: settings.database, access, context });
    return result.isErr ? completionErrorResponse(result.error, context)
      : Response.json({ loginId: result.value.loginId }, {
        headers: { [requestIdHeader]: context.requestId, "cache-control": "no-store" },
      });
  } catch { return reportError(); }
}

function completionErrorResponse(error: FirstSignInError, context: RequestContext): Response {
  switch (error.code) {
    case "accounts_username_invalid":
    case "accounts_username_taken":
    case "accounts_username_reserved":
    case "accounts_username_confirmation_required":
    case "accounts_username_locked": {
      const definition = usernameErrors[error.code];
      return Response.json({ code: error.code, message: definition.message, requestId: context.requestId }, {
        status: definition.status, headers: { [requestIdHeader]: context.requestId, "cache-control": "no-store" },
      });
    }
    default: return createErrorResponse(error, context);
  }
}
