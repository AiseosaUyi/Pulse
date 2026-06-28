import { cookies } from "next/headers";
import { Radar } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { OutboundFiltersEditor } from "@/components/outbound/OutboundFiltersEditor";
import { SettingsPageHeading } from "../_shared";
import {
  DEFAULT_OUTBOUND_FILTERS,
  type OutboundFilters,
} from "@/lib/types/outbound-filters";
import { outboundFiltersSchema } from "@/lib/validation/outbound-filters";

export default async function OutboundFiltersPage() {
  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get("tenant")?.value ?? "gruve";

  const supabase = await createClient();
  const { data: tenant } = await supabase
    .from("tenants")
    .select("name, settings")
    .eq("slug", tenantSlug)
    .single();

  const settings =
    (tenant?.settings as Record<string, unknown> | null) ?? {};
  const stored = settings.outbound_filters;
  const parsed = stored ? outboundFiltersSchema.safeParse(stored) : null;
  const initial: OutboundFilters =
    parsed && parsed.success ? parsed.data : DEFAULT_OUTBOUND_FILTERS;

  return (
    <div className="max-w-[760px] space-y-6">
      <SettingsPageHeading
        icon={Radar}
        title="Outbound filters"
        subtitle={`Keywords, locations, and platforms Pulse uses to find and score new leads for ${tenant?.name ?? tenantSlug}.`}
      />

      <section className="bg-card border border-border rounded-2xl p-6">
        <OutboundFiltersEditor
          tenantSlug={tenantSlug}
          initialFilters={initial}
        />
      </section>
    </div>
  );
}
