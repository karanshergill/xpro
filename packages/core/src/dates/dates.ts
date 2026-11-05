import { Temporal } from "temporal-polyfill/implementation";

export function parseUtcTimestamp(value: string): number | null {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? milliseconds : null;
}

export function formatDateTime(value: string, options: { locale: string; timeZone: string }): string {
  return new Intl.DateTimeFormat(options.locale, { dateStyle: "medium", timeStyle: "short", timeZone: options.timeZone })
    .format(Temporal.Instant.from(value).epochMilliseconds);
}
