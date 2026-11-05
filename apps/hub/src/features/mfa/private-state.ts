import { useEffect } from "react";

export function clearMfaPrivateForms(): void {
  // Blank private inputs and QR drawings synchronously before navigation can
  // suspend the old page; React state updates alone may not render in time.
  for (const element of document.querySelectorAll<HTMLFormElement>("form[data-mfa-credentials]")) {
    element.reset(); for (const input of element.querySelectorAll("input")) input.value = "";
  }
  for (const input of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-mfa-private]")) input.value = "";
  for (const qr of document.querySelectorAll<SVGSVGElement>("[data-mfa-qr]")) qr.replaceChildren();
}

export function useClearMfaOnLeave(onClear: () => void): void {
  useEffect(() => {
    window.addEventListener("pagehide", onClear);
    return () => window.removeEventListener("pagehide", onClear);
  }, [onClear]);
}
