// Naive in-memory fixed-window limiters. Cheap floor against a runaway
// skill loop, and against unauthenticated cost/DoS abuse of the token
// lookup itself (every request bearing a well-formed pulse_ext_ prefix
// costs a real Supabase admin-client round-trip, whether or not the
// token is valid).
//
// TODO: replace with an Upstash-backed limiter — these Maps are per
// serverless instance, reset on cold start, and aren't shared across
// concurrent Vercel invocations, so they're a soft limit at best.

const buckets = new Map<string, { count: number; resetAt: number }>();

function check(
  namespace: string,
  key: string,
  windowMs: number,
  maxRequests: number
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const bucketKey = `${namespace}:${key}`;
  const now = Date.now();
  const bucket = buckets.get(bucketKey);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (bucket.count >= maxRequests) {
    return { ok: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { ok: true };
}

/** Per-token limit, applied once a token has resolved. */
export function checkRateLimit(tokenId: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
  return check("token", tokenId, 60_000, 60);
}

/** Per-IP limit, applied BEFORE the token lookup — any request with a
 * well-formed bearer prefix costs a real DB round-trip regardless of
 * whether the token turns out to be valid, so this has to gate ahead
 * of resolveApiToken(), not after it. Generous ceiling since many
 * legitimate callers can share one IP (corporate NAT, a shared runner). */
export function checkPreAuthRateLimit(ip: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
  return check("preauth-ip", ip, 60_000, 300);
}
