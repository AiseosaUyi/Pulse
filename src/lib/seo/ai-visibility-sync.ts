// Daily AI-visibility sweep (W4). For each tenant with a known domain (taken
// from its GSC property) and tracked keywords, ask the configured AI engine
// whether the domain is cited, and upsert ai_visibility_daily. Dormant when
// no engine is configured — writes nothing rather than fabricating citations.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  checkPerplexityVisibility,
  isPerplexityConfigured,
} from "@/lib/integrations/ai-visibility";

const KEYWORD_CAP_PER_TENANT = 20; // bound API spend per run

function bareDomain(siteUrl: string): string {
  return siteUrl
    .replace(/^sc-domain:/, "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
}

export async function syncAiVisibility(): Promise<{
  status: "ok" | "partial" | "skipped";
  rowsProcessed: number;
  metadata: Record<string, unknown>;
}> {
  if (!isPerplexityConfigured()) {
    return {
      status: "skipped",
      rowsProcessed: 0,
      metadata: { reason: "no AI engine configured (PERPLEXITY_API_KEY unset)" },
    };
  }

  const admin = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);

  // Tenant → domain, from the GSC property they connected.
  const { data: integrations } = await admin
    .from("tenant_integrations")
    .select("tenant_slug, config")
    .eq("provider", "gsc")
    .eq("status", "connected");

  const domains = new Map<string, string>();
  for (const r of integrations ?? []) {
    const url = String((r.config as Record<string, unknown>)?.site_url ?? "");
    if (url) domains.set(r.tenant_slug as string, bareDomain(url));
  }

  let checked = 0;
  let cited = 0;
  let failed = 0;

  for (const [tenant, domain] of domains) {
    const { data: keywords } = await admin
      .from("keyword_rankings")
      .select("keyword")
      .eq("tenant_slug", tenant)
      .limit(KEYWORD_CAP_PER_TENANT);

    for (const kw of keywords ?? []) {
      const result = await checkPerplexityVisibility(kw.keyword, domain);
      if (!result.checked) continue;
      if (result.error) {
        failed++;
        continue;
      }
      checked++;
      if (result.cited) cited++;

      await admin.from("ai_visibility_daily").upsert(
        {
          tenant_slug: tenant,
          query: kw.keyword,
          engine: result.engine,
          date: today,
          cited: result.cited,
          position: result.position,
          source_url: result.sourceUrl,
        },
        { onConflict: "tenant_slug,query,engine,date" }
      );
    }
  }

  return {
    status: failed > 0 ? "partial" : "ok",
    rowsProcessed: checked,
    metadata: { tenants: domains.size, checked, cited, failed },
  };
}
