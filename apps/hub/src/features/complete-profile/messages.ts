import { m } from "#paraglide/messages.js";
import type { FieldErrors } from "./complete-profile";
import type { CompletionFailure } from "./complete-profile";

export function getFailureFields(error: CompletionFailure): FieldErrors {
  switch (error.code) {
    case "accounts_username_invalid": return { username: m.accounts_complete_profile_username_invalid() };
    case "accounts_username_taken": return { username: m.accounts_complete_profile_username_taken() };
    case "accounts_username_reserved": return { username: m.accounts_complete_profile_username_reserved() };
    case "accounts_username_confirmation_required": return { isUsernameConfirmed: m.accounts_complete_profile_confirmation_required() };
    case "core_invalid_input": {
      const fields: FieldErrors = {};
      for (const field of error.fields ?? []) {
        switch (field) {
          case "username": fields.username = m.accounts_complete_profile_username_invalid(); break;
          case "name": fields.name = m.accounts_complete_profile_name_required(); break;
          case "phone": fields.phone = m.accounts_complete_profile_phone_invalid(); break;
          case "isUsernameConfirmed": fields.isUsernameConfirmed = m.accounts_complete_profile_confirmation_required(); break;
        }
      }
      return fields;
    }
    default: return {};
  }
}

export function getFailureMessage(error: CompletionFailure | undefined): string {
  switch (error?.code) {
    case "core_unauthenticated": return m.core_session_ended();
    case "core_login_inactive": return m.core_login_inactive();
    case "core_creation_incomplete": return m.core_creation_incomplete();
    case "accounts_profile_changed": return m.accounts_complete_profile_changed();
    case "accounts_username_invalid":
    case "accounts_username_taken":
    case "accounts_username_reserved":
    case "accounts_username_confirmation_required":
    case "core_invalid_input": return m.accounts_complete_profile_errors_title();
    default: return m.core_error_message();
  }
}
