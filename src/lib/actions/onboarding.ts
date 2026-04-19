"use server";

// Onboarding bulk actions — wired up to the sidebar checklist. Each
// one takes the simplest possible input (a multi-line string of
// names/keywords) and creates the rows with sane defaults. The user
// can go deeper in each module's native UI later.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant, requireUser } from "@/lib/auth";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

function splitAndDedupe(raw: string, max = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const v = line.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function tryParseDomain(name: string): {
  cleanName: string;
  website: string | null;
} {
  const trimmed = name.trim();
  const looksLikeUrl =
    /^https?:\/\//i.test(trimmed) || /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed);
  if (looksLikeUrl) {
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      host = trimmed;
    }
    const prettyName = host.split(".")[0];
    return {
      cleanName:
        prettyName.charAt(0).toUpperCase() + prettyName.slice(1),
      website: url,
    };
  }
  return { cleanName: trimmed, website: null };
}

/**
 * Bulk add competitors from a multi-line string. Each line can be a
 * name ("Acme") or a URL ("https://acme.com") — we'll parse either.
 * Defaults: type=direct, threat_level=medium, empty strengths/weaknesses.
 * User can edit in /competition after creation.
 */
export async function bulkAddCompetitors(
  raw: string
): Promise<ActionResult<{ added: number }>> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const names = splitAndDedupe(raw, 20);
  if (names.length === 0) {
    return { success: false, error: "Add at least one competitor." };
  }

  const rows = names.map((n) => {
    const { cleanName, website } = tryParseDomain(n);
    return {
      tenant_id: tenant.slug,
      name: cleanName,
      website,
      type: "direct" as const,
      threat_level: "medium" as const,
      strengths: [] as string[],
      weaknesses: [] as string[],
      platforms: [] as unknown[],
    };
  });

  const supabase = await createClient();
  const { error, count } = await supabase
    .from("competitors")
    .insert(rows, { count: "exact" });

  if (error) return { success: false, error: error.message };

  revalidatePath("/competition");
  revalidatePath("/intel-feed");
  revalidatePath("/dashboard");
  return { success: true, added: count ?? rows.length };
}

/**
 * Bulk add tracked keywords from a multi-line string. Each line is a
 * keyword. Defaults: difficulty=medium, volume=0, position=null. User
 * enriches in /seo-tracker/keywords.
 */
export async function bulkAddKeywords(
  raw: string
): Promise<ActionResult<{ added: number; skippedDuplicates: number }>> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const keywords = splitAndDedupe(raw, 30);
  if (keywords.length === 0) {
    return { success: false, error: "Add at least one keyword." };
  }

  const supabase = await createClient();

  // Read existing so we can report dedupe count back to the user.
  const { data: existing } = await supabase
    .from("keyword_rankings")
    .select("keyword")
    .eq("tenant_slug", tenant.slug);

  const existingSet = new Set(
    ((existing ?? []) as Array<{ keyword: string }>).map((r) =>
      r.keyword.toLowerCase()
    )
  );

  const fresh = keywords.filter((k) => !existingSet.has(k.toLowerCase()));
  const skipped = keywords.length - fresh.length;

  if (fresh.length === 0) {
    return {
      success: true,
      added: 0,
      skippedDuplicates: skipped,
    };
  }

  const rows = fresh.map((k) => ({
    tenant_slug: tenant.slug,
    keyword: k,
    url: null,
    position: null,
    previous_position: null,
    volume: 0,
    difficulty: "medium" as const,
    last_checked: null,
    notes: null,
    created_by: user.id,
  }));

  const { error, count } = await supabase
    .from("keyword_rankings")
    .insert(rows, { count: "exact" });

  if (error) return { success: false, error: error.message };

  revalidatePath("/seo-tracker");
  revalidatePath("/seo-tracker/keywords");
  revalidatePath("/dashboard");
  return {
    success: true,
    added: count ?? rows.length,
    skippedDuplicates: skipped,
  };
}
