import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ScoutConfigEditor } from "@/components/trends/ScoutConfigEditor";

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
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 md:py-12 space-y-6">
      <div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-foreground mb-3 transition-colors"
        >
          <ArrowLeft size={14} />
          Back to settings
        </Link>
        <h1
          className="text-2_5xl text-gray-1100 tracking-tight"
          style={{ fontFamily: "'Satoshi-900', var(--font-sans)" }}
        >
          Trend scouts
        </h1>
        <p className="text-sm text-gray-1000 mt-2">
          Configure what the daily scrape tracks for{" "}
          <span className="text-gray-1200 [font-family:'Satoshi-500',var(--font-sans)]">
            {tenant?.name ?? tenantSlug}
          </span>
          .
        </p>
      </div>

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
