import { z } from "zod";
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
