import { cookies } from "next/headers";
import { TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ScoutConfigEditor } from "@/components/trends/ScoutConfigEditor";
import { SettingsPageHeading } from "../_shared";

export default async function TrendScoutsPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, settings")
    .eq("slug", tenantSlug)
    .single();

  const settings = (tenant?.settings as Record<string, unknown> | null) ?? {};
  const scout = (settings.scout_config as
    | { instagram_hashtags?: string[]; tiktok_hashtags?: string[] }
    | undefined) ?? {};

  return (
    <div className="max-w-[760px] space-y-6">
      <SettingsPageHeading
        icon={TrendingUp}
        title="Trend scouts"
        subtitle={`Hashtags the daily scrape tracks for ${tenant?.name ?? tenantSlug}. Results surface on Viral Trends and inside Content Vault.`}
      />

      <section className="bg-card border border-border rounded-2xl p-6">
        <ScoutConfigEditor
          tenantSlug={tenantSlug}
          initialInstagramHashtags={scout.instagram_hashtags ?? []}
          initialTiktokHashtags={scout.tiktok_hashtags ?? []}
        />
      </section>
    </div>
  );
}
