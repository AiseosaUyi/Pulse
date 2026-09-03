import { z, type ZodIssue } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export const brandVoiceSchema = z.object({
  tone: z.string().min(1, "Tone is required"),
  audience: z.string().min(1, "Audience is required"),
  do_list: z.array(z.string().min(1)).min(1, "At least one 'do' is required"),
  dont_list: z.array(z.string().min(1)).min(1, "At least one 'don't' is required"),
  example_posts: z
    .array(z.string().min(1))
    .min(1, "At least one example post is required"),
});

export type BrandVoice = z.infer<typeof brandVoiceSchema>;

export async function getBrandVoice(tenantSlug: string): Promise<BrandVoice | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (error || !data?.settings) return null;
  const parsed = brandVoiceSchema.safeParse(
    (data.settings as { brand_voice?: unknown }).brand_voice
  );
  return parsed.success ? parsed.data : null;
}

export function isBrandVoiceComplete(
  value: unknown
): value is BrandVoice {
  return brandVoiceSchema.safeParse(value).success;
}

/**
 * Client-injected setter — the shared write path for both the
 * settings/brand-voice server action (session client, RLS-enforced) and
 * the /api/v1/me POST route + pulse_update_brand_voice MCP tool (admin
 * client, bearer-token auth has no session for RLS to key off). Validates
 * unconditionally, unlike the pre-existing updateBrandVoice server action
 * this replaces the body of, which had no validation at all.
 */
export async function setBrandVoice(
  client: SupabaseClient,
  tenantSlug: string,
  input: unknown
): Promise<{ ok: true; data: BrandVoice } | { ok: false; error: string; issues?: ZodIssue[] }> {
  const parsed = brandVoiceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((i) => i.message).join(" · "),
      issues: parsed.error.issues,
    };
  }

  const { data: tenant, error: readError } = await client
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };

  const existing = (tenant?.settings as Record<string, unknown>) ?? {};
  const merged = { ...existing, brand_voice: parsed.data };

  const { error: writeError } = await client.from("tenants").update({ settings: merged }).eq("slug", tenantSlug);
  if (writeError) return { ok: false, error: writeError.message };

  return { ok: true, data: parsed.data };
}
