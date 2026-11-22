/**
 * Meta reports insights by calendar day in the *ad account's* timezone.
 * Shopify returns order timestamps in UTC. Joining them by naive UTC date
 * shifts late-evening orders into the wrong day, so every order date is
 * converted into the ad account timezone before grouping.
 */
export function dateInTimezone(isoUtc: string, timeZone: string): string {
  const d = new Date(isoUtc);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid timestamp: ${isoUtc}`);
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function todayInTimezone(timeZone: string, now = new Date()): string {
  return dateInTimezone(now.toISOString(), timeZone);
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Inclusive list of YYYY-MM-DD dates. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
