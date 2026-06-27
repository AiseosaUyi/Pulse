import { cookies } from "next/headers";
import { getBrandVoice } from "@/lib/ai/brand-voice";
import { createAdminClient } from "@/lib/supabase/admin";
import { BrandVoiceEditor } from "@/components/briefs/BrandVoiceEditor";

export default async function BrandVoicePage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";
  const admin = createAdminClient();
  const [voice, countResult] = await Promise.all([
    getBrandVoice(tenantSlug),
    admin
      .from("blog_posts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_slug", tenantSlug)
      .eq("status", "published"),
  ]);
  const publishedPostCount = countResult.count ?? 0;

  return (
    <div className="max-w-[760px]">
      <div className="mb-5">
        <h1 className="text-xl md:text-2xl font-bold text-foreground">
          Brand voice
        </h1>
        <p className="text-text-secondary text-sm mt-0.5">
          Ground the AI in your actual voice. Feeds every generated brief.
        </p>
      </div>

      <BrandVoiceEditor tenantSlug={tenantSlug} initial={voice} publishedPostCount={publishedPostCount} />
    </div>
  );
}
