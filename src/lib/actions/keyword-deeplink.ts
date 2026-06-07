"use server";

// Turn a tracked keyword into a Gruve discovery deep-link. "top raves in
// Lagos" → /home?category=music&location=Lagos. Returns both the live (www)
// and gamma URLs (same path works on both — they're the same app) and, when
// a keyword row id is given, saves the live URL onto keyword_rankings.url.

import { requireUser, getCurrentTenant } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { mapKeywordToGruve, type KeywordMapping } from "@/lib/ai/keyword-to-gruve";
import { buildGruveDiscoveryUrl, GRUVE_HOSTS } from "@/lib/seo/gruve-discovery";

export interface KeywordDeeplinkResult {
  keyword: string;
  mapping: KeywordMapping;
  liveUrl: string;
  gammaUrl: string;
}

export type DeeplinkResponse =
  | { success: true; data: KeywordDeeplinkResult }
  | { success: false; error: string };

export async function generateKeywordDeeplink(
  keyword: string,
  opts?: { keywordId?: string; persist?: boolean }
): Promise<DeeplinkResponse> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No active tenant" };
  if (!keyword.trim()) return { success: false, error: "Keyword is empty" };

  const mapping = await mapKeywordToGruve(tenant.slug, keyword);
  const filters = { location: mapping.location, category: mapping.category, when: mapping.when };
  const liveUrl = buildGruveDiscoveryUrl(filters, GRUVE_HOSTS.live);
  const gammaUrl = buildGruveDiscoveryUrl(filters, GRUVE_HOSTS.gamma);

  if (opts?.persist && opts.keywordId) {
    const supabase = await createClient();
    await supabase
      .from("keyword_rankings")
      .update({ url: liveUrl })
      .eq("id", opts.keywordId)
      .eq("tenant_slug", tenant.slug);
  }

  return { success: true, data: { keyword, mapping, liveUrl, gammaUrl } };
}

/** Map every tracked keyword that has no url yet; persist the live URL. */
export async function backfillKeywordDeeplinks(): Promise<
  { success: true; updated: number } | { success: false; error: string }
> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No active tenant" };

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("keyword_rankings")
    .select("id, keyword, url")
    .eq("tenant_slug", tenant.slug)
    .is("url", null);
  if (error) return { success: false, error: error.message };

  let updated = 0;
  for (const row of rows ?? []) {
    const mapping = await mapKeywordToGruve(tenant.slug, row.keyword);
    const liveUrl = buildGruveDiscoveryUrl(
      { location: mapping.location, category: mapping.category, when: mapping.when },
      GRUVE_HOSTS.live
    );
    const { error: upErr } = await supabase
      .from("keyword_rankings")
      .update({ url: liveUrl })
      .eq("id", row.id)
      .eq("tenant_slug", tenant.slug);
    if (!upErr) updated++;
  }
  return { success: true, updated };
}
