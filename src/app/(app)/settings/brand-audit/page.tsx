import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { BrandAuditClient } from "./client";
import { SettingsPageHeading } from "../_shared";

export default async function BrandAuditPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const admin = createAdminClient();
  const [
    { data: tenant },
    { count: competitorCount },
    { count: keywordCount },
    { count: briefCount },
  ] = await Promise.all([
    admin
      .from("tenants")
      .select("name,settings")
      .eq("slug", tenantSlug)
      .single(),
    admin
      .from("competitors")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantSlug),
    admin
      .from("keyword_rankings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_slug", tenantSlug),
    admin
      .from("content_briefs")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantSlug)
      .is("dismissed_at", null),
  ]);

  const settings =
    (tenant?.settings as Record<string, unknown> | undefined) ?? {};
  const voice = settings.brand_voice as Record<string, unknown> | undefined;
  const positioning = settings.brand_positioning as
    | Record<string, unknown>
    | undefined;
  const auditMeta = settings.brand_audit_meta as
    | Record<string, unknown>
    | undefined;

  return (
    <div className="max-w-[680px]">
      <SettingsPageHeading
        title="Brand audit"
        subtitle="Pulse scrapes your site and extracts your brand voice, positioning, competitors, keywords, and starter content briefs. Re-run any time — takes about 60 seconds."
      />

      <BrandAuditClient
        tenantSlug={tenantSlug}
        tenantName={tenant?.name ?? tenantSlug}
        currentUrl={(auditMeta?.url as string) ?? null}
        lastAuditAt={(auditMeta?.ran_at as string) ?? null}
        hasBrandVoice={!!voice?.tone}
        hasBrandPositioning={!!positioning?.mission}
        competitorCount={competitorCount ?? 0}
        keywordCount={keywordCount ?? 0}
        briefCount={briefCount ?? 0}
      />
    </div>
  );
}
