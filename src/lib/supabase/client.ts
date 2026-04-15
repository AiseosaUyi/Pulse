import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Default client — respects RLS, scoped to tenant
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Service-role client — bypasses RLS, used for cross-brand queries only
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
