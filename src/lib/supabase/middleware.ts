import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// `/.well-known` is exempt so Gruve can fetch the JWKS (rewritten to
// /api/jwks) without the auth redirect. The vercel.json rewrite runs
// AFTER this proxy, so the original `/.well-known/jwks.json` path must
// pass through here un-gated or it 307s to /login.
// `/r` is the public short-link redirector (trackable campaign links) — it must
// be hittable by anyone, including logged-out customers on IG/WhatsApp.
const PUBLIC_PATHS = ["/login", "/signup", "/auth", "/invite", "/forgot-password", "/api/cron", "/.well-known", "/r"];

// Refreshes the Supabase session and gates unauthenticated routes.
// Called from proxy.ts on every request.
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
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  // API routes own their own auth (Bearer token for /api/ext/*, getCurrentUser
  // for /api/vault/*, cron secret for /api/cron/*) and return JSON 401. A
  // redirect-to-login HTML response breaks JSON fetches and cross-origin
  // extension calls, so let the route handler run and 401 itself.
  const isApi = pathname.startsWith("/api/");

  if (!user && !isPublic && !isApi) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.searchParams.delete("next");
    return NextResponse.redirect(url);
  }

  return response;
}
