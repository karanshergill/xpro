import type { CustomFetch } from "@tanstack/react-start";
import { pageLoginIdHeader } from "@xpro/core";
import { isSessionFailure, readSessionFailure, sessionFailureEventName, type SessionFailureEvent } from "./session";

export const fetchWorkspace: CustomFetch = async (url, options) => {
  const startedAt = performance.now(), headers = new Headers(options?.headers);
  const loginId = document.getElementById("workspace-page")?.dataset.loginId;
  if (loginId) headers.set(pageLoginIdHeader, loginId);
  const response = await fetch(url, { ...options, headers, cache: "no-store" });
  if (response.status !== 401 && response.status !== 403 && response.status !== 409) return response;
  const body: unknown = await response.clone().json().catch((): unknown => null);
  const failure = readSessionFailure(body);
  if (isSessionFailure(failure.code)) {
    const detail: SessionFailureEvent = { ...failure, startedAt };
    window.dispatchEvent(new CustomEvent(sessionFailureEventName, { detail }));
  }
  return response;
};
