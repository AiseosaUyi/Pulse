import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client — bypasses RLS. Server-only.
// Use for cross-tenant operations (e.g. cross-brand pattern detection).
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
