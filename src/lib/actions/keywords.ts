"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant, requireUser } from "@/lib/auth";

const DIFFICULTIES = ["easy", "medium", "hard"] as const;

function isOneOf<T extends readonly string[]>(list: T, v: unknown): v is T[number] {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function intOrNull(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

function nonNegInt(formData: FormData, key: string): number {
  const raw = str(formData, key);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export async function createKeywordRanking(formData: FormData) {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const keyword = str(formData, "keyword");
  const url = str(formData, "url") || null;
  const difficulty = formData.get("difficulty") ?? "medium";

  if (!keyword) return { success: false, error: "Keyword is required" };
  if (!isOneOf(DIFFICULTIES, difficulty)) return { success: false, error: "Invalid difficulty" };

  const supabase = await createClient();
  const { error } = await supabase.from("keyword_rankings").insert({
    tenant_slug: tenant.slug,
    keyword,
    url,
    position: intOrNull(formData, "position"),
    previous_position: intOrNull(formData, "previousPosition"),
    volume: nonNegInt(formData, "volume"),
    difficulty,
    last_checked: str(formData, "lastChecked") || null,
    notes: str(formData, "notes") || null,
    created_by: user.id,
  });

  if (error) {
    if (error.code === "23505") {
      return { success: false, error: "You already track that keyword" };
    }
    return { success: false, error: error.message };
  }

  revalidatePath("/seo-tracker");
  return { success: true };
}

export async function updateKeywordPosition(
  keywordId: string,
  newPosition: number | null
) {
  await requireUser();

  const supabase = await createClient();
  const { data: current, error: readErr } = await supabase
    .from("keyword_rankings")
    .select("position")
    .eq("id", keywordId)
    .single();

  if (readErr || !current) {
    return { success: false, error: "Keyword not found" };
  }

  const { error } = await supabase
    .from("keyword_rankings")
    .update({
      previous_position: current.position,
      position: newPosition,
      last_checked: new Date().toISOString().slice(0, 10),
    })
    .eq("id", keywordId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/seo-tracker");
  return { success: true };
}

export async function deleteKeywordRanking(keywordId: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("keyword_rankings").delete().eq("id", keywordId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/seo-tracker");
  return { success: true };
}
