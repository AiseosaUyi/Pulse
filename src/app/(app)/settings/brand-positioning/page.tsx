import { getCurrentTenant } from "@/lib/auth";
import { Target } from "lucide-react";
import { getBrandPositioning } from "@/lib/ai/brand-positioning";
import { BrandPositioningEditor } from "@/components/settings/BrandPositioningEditor";
import { SettingsPageHeading } from "../_shared";

export default async function BrandPositioningPage() {
  const tenant = await getCurrentTenant();
  const tenantSlug = tenant?.slug ?? "";
  const positioning = await getBrandPositioning(tenantSlug);

  return (
    <div className="max-w-[960px]">
      <SettingsPageHeading
        icon={Target}
        title="Brand positioning"
        subtitle="The *what* and *who* that feeds every AI generation. Brand voice (tone, do/don't) lives separately — both layer together on every call."
      />

      <BrandPositioningEditor tenantSlug={tenantSlug} initial={positioning} />
    </div>
  );
}
