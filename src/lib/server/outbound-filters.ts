// Reader for tenants.settings.outbound_filters. Falls back to the
// seeded defaults when nothing is stored or when the stored value
// fails validation (stale shape). Wrapped in React cache so multiple
// AI call sites in a single request share one DB round-trip.

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_OUTBOUND_FILTERS,
  type OutboundFilters,
} from "@/lib/types/outbound-filters";
import { outboundFiltersSchema } from "@/lib/validation/outbound-filters";

export const getOutboundFilters = cache(
  async (tenantSlug: string): Promise<OutboundFilters> => {
    const admin = createAdminClient();
    const { data } = await admin
      .from("tenants")
      .select("settings")
      .eq("slug", tenantSlug)
      .maybeSingle();

    if (!data?.settings) return DEFAULT_OUTBOUND_FILTERS;

    const stored = (data.settings as { outbound_filters?: unknown })
      .outbound_filters;
    if (!stored) return DEFAULT_OUTBOUND_FILTERS;

    const parsed = outboundFiltersSchema.safeParse(stored);
    if (!parsed.success) return DEFAULT_OUTBOUND_FILTERS;
    return parsed.data;
  }
);
