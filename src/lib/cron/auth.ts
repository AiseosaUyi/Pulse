// Cron request verification. Vercel Cron sends:
//   authorization: Bearer <CRON_SECRET>
//   user-agent: vercel-cron/1.0  (approximately)
// Plus x-vercel-cron is set on real Vercel Cron invocations but absent
// on manual curl hits. In production we require BOTH the bearer match
// AND the x-vercel-cron header to be present — this blocks a leaked
// CRON_SECRET from letting anyone trigger expensive scrape/AI runs
// directly. In development or when running tests we relax the Vercel
// header check (the bearer is still required).

import { timingSafeEqual } from "node:crypto";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

export interface VerifyOptions {
  /** Read a header by lowercase name. */
  getHeader: (name: string) => string | null;
  /** Override for tests. Defaults to process.env.CRON_SECRET. */
  secret?: string | undefined;
  /** Override for tests. Defaults to process.env.NODE_ENV === "production". */
  requireVercelHeader?: boolean;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  // timingSafeEqual throws on length mismatch; pad to avoid leaking length
  // via early-return. Compare against the longer of the two.
  if (ab.length !== bb.length) {
    const max = Math.max(ab.length, bb.length);
    const pa = Buffer.alloc(max);
    const pb = Buffer.alloc(max);
    ab.copy(pa);
    bb.copy(pb);
    timingSafeEqual(pa, pb);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function verifyCronRequest(opts: VerifyOptions): CronAuthResult {
  const secret = opts.secret ?? process.env.CRON_SECRET;
  if (!secret) {
    return {
      ok: false,
      status: 503,
      error: "CRON_SECRET not configured on the server",
    };
  }

  const authHeader = opts.getHeader("authorization") ?? "";
  if (!constantTimeEquals(authHeader, `Bearer ${secret}`)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const requireVercel =
    opts.requireVercelHeader ?? process.env.NODE_ENV === "production";
  if (requireVercel) {
    const vercelMarker = opts.getHeader("x-vercel-cron");
    if (!vercelMarker) {
      return {
        ok: false,
        status: 401,
        error: "Missing Vercel Cron marker",
      };
    }
  }

  return { ok: true };
}

/** Convenience wrapper for Next route handlers. */
export function verifyFromRequest(req: Request): CronAuthResult {
  return verifyCronRequest({
    getHeader: (name) => req.headers.get(name),
  });
}
