import { createClient } from "@/lib/supabase/server";

export interface EngageCandidate {
  id: string;
  platform: "x" | "linkedin";
  authorHandle: string | null;
  content: string;
  externalUrl: string | null;
  discoveredAt: string;
}

/** Active (not-dismissed) discovered posts worth engaging with, newest first. */
export async function listEngageCandidates(tenantSlug: string): Promise<EngageCandidate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("engage_candidates")
    .select("id, platform, author_handle, content, external_url, discovered_at")
    .eq("tenant_slug", tenantSlug)
    .eq("dismissed", false)
    .order("discovered_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    platform: r.platform as "x" | "linkedin",
    authorHandle: (r.author_handle as string) ?? null,
    content: r.content as string,
    externalUrl: (r.external_url as string) ?? null,
    discoveredAt: r.discovered_at as string,
  }));
}
