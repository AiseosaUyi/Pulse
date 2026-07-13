import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// `/.well-known` is exempt so Gruve can fetch the JWKS (rewritten to
// /api/jwks) without the auth redirect. The vercel.json rewrite runs
// AFTER this proxy, so the original `/.well-known/jwks.json` path must
// pass through here un-gated or it 307s to /login.
// `/r` is the public short-link redirector (trackable campaign links) — it must
// be hittable by anyone, including logged-out customers on IG/WhatsApp.
// `/approve` is the mobile approval page (Part 3 of the /api/v1 + MCP build
// spec) — reached via a signed one-time link in an email/WhatsApp message,
// no session exists. Auth is the JWT in the URL, verified by the page itself.
const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/invite", "/forgot-password", "/api/cron", "/.well-known", "/r", "/pricing", "/approve"];

// Refreshes the Supabase session and gates unauthenticated routes.
// Called from middleware.ts on every request.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Must call getUser() to refresh the token cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === "/" ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // API routes own their own auth (Bearer token for /api/ext/*, getCurrentUser
  // for /api/vault/*, cron secret for /api/cron/*) and return JSON 401. A
  // redirect-to-login HTML response breaks JSON fetches and cross-origin
  // extension calls, so let the route handler run and 401 itself.
  const isApi = pathname.startsWith("/api/");

  if (!user && !isPublic && !isApi) {
    // Build the redirect URL from scratch — nextUrl.clone() in Next.js 16
    // doesn't always serialize search params correctly when used with
    // NextResponse.redirect, so we construct the absolute URL manually.
    // `next` carries pathname + search (not just pathname) — a bare
    // pathname silently drops query params, which broke the /oauth/authorize
    // flow (client_id/redirect_uri/code_challenge/state all vanish on the
    // login round-trip). login/actions.ts's `redirect(next)` already
    // handles an arbitrary path+query string safely.
    const origin = request.nextUrl.origin;
    const nextTarget = pathname + request.nextUrl.search;
    const loginUrl = new URL(`/login?next=${encodeURIComponent(nextTarget)}`, origin);
    return NextResponse.redirect(loginUrl);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const origin = request.nextUrl.origin;
    return NextResponse.redirect(new URL("/dashboard", origin));
  }

  return response;
}
