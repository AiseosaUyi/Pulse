export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toString();
}

// Deterministic date/time/number formatting for the UI.
//
// In a client component the same render runs on the server (for the SSR HTML)
// and again on the client (for hydration). `toLocaleDateString()` /
// `toLocaleString()` without an explicit locale + timeZone use the runtime's
// own locale and zone, so the server (UTC / Node default locale) and the
// browser (the user's locale + zone) produce DIFFERENT strings — React then
// throws hydration error #418 and re-renders the whole subtree. Pinning both
// the locale and the timeZone makes the output identical everywhere.
//
// Africa/Lagos matches the product's market (and the en-NG currency above);
// it has a fixed UTC+1 offset with no DST, so dates/times stay stable.
export const APP_TIME_ZONE = "Africa/Lagos";

export function formatDate(
  value: string | number | Date,
  opts: Intl.DateTimeFormatOptions = {}
): string {
  return new Date(value).toLocaleDateString("en-US", {
    timeZone: APP_TIME_ZONE,
    ...opts,
  });
}

export function formatDateTime(
  value: string | number | Date,
  opts: Intl.DateTimeFormatOptions = {}
): string {
  return new Date(value).toLocaleString("en-US", {
    timeZone: APP_TIME_ZONE,
    ...opts,
  });
}

// Thousands-separated count (e.g. "1,020"). Pins en-US so the separator is
// identical on server and client.
export function formatCount(
  value: number,
  opts: Intl.NumberFormatOptions = {}
): string {
  return value.toLocaleString("en-US", opts);
}

// Coarse "how long has this been waiting" — minutes/hours/days only, never
// seconds, so a render on the server and the same render after client
// hydration (a few hundred ms apart in practice) virtually never land on
// different text and trip a hydration mismatch the way a live ticking
// clock would.
export function formatRelativeTime(value: string | number | Date): string {
  const ms = Date.now() - new Date(value).getTime();
  if (ms < 0) return "just now";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
