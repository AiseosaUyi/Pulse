"use server";

// Recommendation apply/dismiss/snooze (PULSE-SEO-SPEC.md §9). Applying
// captures baseline_30d and arms outcome_due_at = now + 30d — the moat
// wiring, built day one (acceptance M4), NOT retrofitted. Generation of
// recommendations (per-type rubrics) is [GRUVE-PENDING] (spec §13–§16).

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser, getCurrentTenant } from "@/lib/auth";
import { snapshotPostMetrics } from "@/lib/seo/post-metrics";

export type RecActionResult =
  | { success: true }
  | { success: false; error: string };

type LoadRecCtx =
  | { ok: false; error: string }
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      rec: { id: string; tenant_slug: string; slug: string | null; status: string };
      tenantSlug: string;
    };

async function loadRec(recId: string): Promise<LoadRecCtx> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "No active tenant" };
  const supabase = await createClient();
  const { data: rec, error } = await supabase
    .from("seo_recommendations")
    .select("id, tenant_slug, slug, status")
    .eq("id", recId)
    .maybeSingle();
  if (error || !rec) return { ok: false, error: "Recommendation not found" };
  if (rec.tenant_slug !== tenant.slug)
    return { ok: false, error: "Wrong tenant" };
  return { ok: true, supabase, rec, tenantSlug: tenant.slug };
}

export async function applyRecommendation(
  recId: string
): Promise<RecActionResult> {
  await requireUser();
  const ctx = await loadRec(recId);
  if (!ctx.ok) return { success: false, error: ctx.error };
  const { supabase, rec, tenantSlug } = ctx;
  if (rec.status === "applied") return { success: true };

  // Moat: snapshot the pre-change 30-day metrics now.
  const baseline = await snapshotPostMetrics(
    supabase,
    tenantSlug,
    rec.slug ?? ""
  );
  const now = new Date();
  const dueAt = new Date(now.getTime() + 30 * 86_400_000);

  const { error } = await supabase
    .from("seo_recommendations")
    .update({
      status: "applied",
      applied_at: now.toISOString(),
      baseline_30d: baseline,
      outcome_due_at: dueAt.toISOString(),
    })
    .eq("id", recId);
  if (error) return { success: false, error: error.message };

  revalidatePath("/seo-tracker");
  return { success: true };
}

export async function dismissRecommendation(
  recId: string,
  note?: string
): Promise<RecActionResult> {
  await requireUser();
  const ctx = await loadRec(recId);
  if (!ctx.ok) return { success: false, error: ctx.error };
  const { supabase } = ctx;
  const { error } = await supabase
    .from("seo_recommendations")
    .update({
      status: "dismissed",
      dismissed_at: new Date().toISOString(),
      notes: note ?? null,
    })
    .eq("id", recId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/seo-tracker");
  return { success: true };
}

export async function snoozeRecommendation(
  recId: string,
  untilISO: string
): Promise<RecActionResult> {
  await requireUser();
  const ctx = await loadRec(recId);
  if (!ctx.ok) return { success: false, error: ctx.error };
  const { supabase } = ctx;
  const { error } = await supabase
    .from("seo_recommendations")
    .update({ status: "snoozed", snoozed_until: untilISO })
    .eq("id", recId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/seo-tracker");
  return { success: true };
}
