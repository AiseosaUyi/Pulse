"use server";

// Server action that wraps the brand audit pipeline and persists the
// result onto `tenants.settings`. One call does: URL → scrape → AI
// extraction → write `brand_voice` + `brand_positioning`. Deliberately
// synchronous (no chunking) because the full flow runs in ~15-25s,
// well under the 60s Vercel Hobby cap.
//
// If we ever hit the cap on slow sites or token-heavy extractions,
// split into startAudit/advanceAudit like blog-regeneration.ts.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  runBrandAuditAi,
  scrapeSite,
  type BrandAuditResult,
} from "@/lib/ai/brand-audit";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export interface RunBrandAuditOutput {
  summary: string;
  pagesFetched: string[];
  tenantSlug: string;
}

export async function runBrandAudit(
  tenantSlug: string,
  rawUrl: string
): Promise<ActionResult<RunBrandAuditOutput>> {
  const url = rawUrl.trim();
  if (!url) {
    return { success: false, error: "URL is required." };
  }

  try {
    const supabase = await createClient();

    // Confirm membership + read existing settings (merge, don't clobber).
    const { data: tenant, error: readErr } = await supabase
      .from("tenants")
      .select("settings")
      .eq("slug", tenantSlug)
      .maybeSingle();

    if (readErr) return { success: false, error: readErr.message };
    if (!tenant)
      return {
        success: false,
        error: "Tenant not found or you don't have access.",
      };

    const site = await scrapeSite(url);
    const audit: BrandAuditResult = await runBrandAuditAi(tenantSlug, site);

    const existing = (tenant.settings as Record<string, unknown>) ?? {};
    const merged = {
      ...existing,
      brand_voice: audit.voice,
      brand_positioning: audit.positioning,
      brand_audit_meta: {
        url: site.url,
        pages_fetched: audit.pagesFetched,
        ran_at: new Date().toISOString(),
        cost_usd: audit.cost,
        duration_ms: audit.durationMs,
      },
    };

    const { error: writeErr } = await supabase
      .from("tenants")
      .update({ settings: merged })
      .eq("slug", tenantSlug);

    if (writeErr) return { success: false, error: writeErr.message };

    revalidatePath("/settings/brand-voice");
    revalidatePath("/settings/brand-positioning");
    revalidatePath("/dashboard");

    return {
      success: true,
      summary: audit.summary,
      pagesFetched: audit.pagesFetched,
      tenantSlug,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
