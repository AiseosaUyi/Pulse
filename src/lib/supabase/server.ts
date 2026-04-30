import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side Supabase client (Server Components, Route Handlers, Server Actions).
// Reads + writes the Supabase auth cookies via next/headers.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            try {
              cookieStore.set(name, value, options);
            } catch (err) {
              // Only swallow the expected Server-Component write error;
              // any other failure is a real bug that must surface.
              const msg = err instanceof Error ? err.message : String(err);
              if (!msg.includes("Cookies can only be modified")) throw err;
            }
          }
        },
      },
    }
  );
}
