import { getCurrentTenant } from "@/lib/auth";
import { Target } from "lucide-react";
import { getBrandPositioning } from "@/lib/ai/brand-positioning";
import { createAdminClient } from "@/lib/supabase/admin";
import { BrandPositioningEditor } from "@/components/settings/BrandPositioningEditor";
import { SettingsPageHeading } from "../_shared";

export default async function BrandPositioningPage() {
  const tenant = await getCurrentTenant();
  const tenantSlug = tenant?.slug ?? "";
  const positioning = await getBrandPositioning(tenantSlug);

  // `brand_positioning.competitors` is a separate, user-editable JSONB
  // array that the brand-audit AI prompt deliberately leaves empty (see
  // src/lib/ai/brand-audit.ts). It's never automatically kept in sync
  // with the real `competitors` table that the Brand Audit page counts
  // from, so the two pages disagree ("8 competitors" vs "None yet").
  // Seed the editor's initial state from the `competitors` table the
  // first time this array is empty, without touching the JSONB array
  // itself as the source of truth — the user can still freely edit/
  // remove rows here, and saving persists their edited list.
  let initial = positioning;
  if (positioning && positioning.competitors.length === 0) {
    const admin = createAdminClient();
    const { data: competitorRows } = await admin
      .from("competitors")
      .select("name, website")
      .eq("tenant_id", tenantSlug)
      .order("created_at", { ascending: true });
    if (competitorRows && competitorRows.length > 0) {
      initial = {
        ...positioning,
        competitors: competitorRows.map((c) => ({
          name: c.name,
          domain: c.website ?? null,
          why_we_beat_them: null,
        })),
      };
    }
  }

  return (
    <div className="max-w-[960px]">
      <SettingsPageHeading
        icon={Target}
        title="Brand positioning"
        subtitle="The *what* and *who* that feeds every AI generation. Brand voice (tone, do/don't) lives separately — both layer together on every call."
      />

      <BrandPositioningEditor tenantSlug={tenantSlug} initial={initial} />
    </div>
  );
}
