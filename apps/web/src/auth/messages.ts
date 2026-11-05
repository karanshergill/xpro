import { m } from "#paraglide/messages.js";
import type { SessionFailure } from "./session";

export function getSessionTitle(failure: SessionFailure): string {
  switch (failure.code) {
    case "core_unauthenticated": return m.core_session_title();
    case "core_identity_changed": return m.core_session_changed_title();
    case "core_login_inactive":
    case "core_forbidden":
    case "core_creation_incomplete":
    case "core_profile_incomplete": return m.core_session_access_title();
    default: return m.core_session_check_failed_title();
  }
}

export function getSessionMessage(failure: SessionFailure): string {
  switch (failure.code) {
    case "core_unauthenticated": return m.core_session_message();
    case "core_identity_changed": return m.core_session_changed_message();
    case "core_login_inactive":
    case "core_forbidden": return m.core_session_access_message();
    case "core_creation_incomplete": return m.core_session_creation_message();
    case "core_profile_incomplete": return m.core_session_profile_message();
    default: return m.core_error_message();
  }
}
