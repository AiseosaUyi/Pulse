"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getCadenceConfig } from "@/lib/cadence/config";
import { nowInTz } from "@/lib/cadence/compute";
import { cadenceConfigSchema, type CadenceConfig } from "@/lib/cadence/types";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

/** Persist the tenant's cadence config into settings.cadence (read-modify-write merge). RLS gates write to owner/admin. */
export async function saveCadenceConfig(
  tenantSlug: string,
  input: CadenceConfig
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const parsed = cadenceConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(" · "),
    };
  }
  // Window ids must be unique, else done-status dedupe collapses windows.
  const ids = parsed.data.windows.map((w) => w.id);
  if (new Set(ids).size !== ids.length) {
    return { success: false, error: "Each window needs a unique id." };
  }

  const supabase = await createClient();
  const { data: tenant, error: readError } = await supabase
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (readError) return { success: false, error: readError.message };

  const existing = (tenant?.settings as Record<string, unknown>) ?? {};
  const { error: writeError } = await supabase
    .from("tenants")
    .update({ settings: { ...existing, cadence: parsed.data } })
    .eq("slug", tenantSlug);
  if (writeError) return { success: false, error: writeError.message };

  revalidatePath("/settings/cadence");
  revalidatePath("/composer");
  revalidatePath("/today");
  return { success: true };
}

export interface MarkPostedInput {
  /** Cadence window this counts toward; null = ad-hoc post outside any window. */
  windowId?: string | null;
  platform?: string | null;
  sourceDraftId?: string | null;
}

/** Honor-system "I posted this." Resolves posted_date in the tenant tz, guards against double-submit, appends to post_log. */
export async function markAsPosted(
  tenantSlug: string,
  input: MarkPostedInput = {}
): Promise<ActionResult<{ postedDate: string }>> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const config = await getCadenceConfig(tenantSlug);
  const tz = config?.timezone ?? "UTC";
  const postedDate = nowInTz(tz).date;
  const windowId = input.windowId ?? null;

  const supabase = await createClient();

  // App-level double-submit guard (post_log has no unique constraint by design):
  // for a specific window, skip if an identical row was logged in the last 8s.
  if (windowId) {
    const since = new Date(Date.now() - 8_000).toISOString();
    const { data: recent } = await supabase
      .from("post_log")
      .select("id")
      .eq("tenant_slug", tenantSlug)
      .eq("window_id", windowId)
      .eq("posted_date", postedDate)
      .gte("posted_at", since)
      .limit(1);
    if (recent && recent.length > 0) {
      return { success: true, postedDate }; // idempotent: treat as already logged
    }
  }

  const { error } = await supabase.from("post_log").insert({
    tenant_slug: tenantSlug,
    window_id: windowId,
    posted_date: postedDate,
    platform: input.platform ?? null,
    source_draft_id: input.sourceDraftId ?? null,
    created_by: user.id,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath("/composer");
  revalidatePath("/today");
  return { success: true, postedDate };
}
