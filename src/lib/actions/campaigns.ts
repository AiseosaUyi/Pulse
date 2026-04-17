"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant, requireUser } from "@/lib/auth";

const PLATFORMS = [
  "instagram",
  "tiktok",
  "twitter",
  "linkedin",
  "google",
  "facebook",
  "youtube",
] as const;
const STATUSES = ["active", "paused", "completed", "draft"] as const;

function isOneOf<T extends readonly string[]>(list: T, v: unknown): v is T[number] {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function num(formData: FormData, key: string): number {
  const raw = str(formData, key);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export async function createCampaign(formData: FormData) {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const name = str(formData, "name");
  const platform = formData.get("platform");
  const status = formData.get("status") ?? "draft";
  const startDate = str(formData, "startDate") || null;
  const endDate = str(formData, "endDate") || null;
  const notes = str(formData, "notes") || null;

  if (!name) return { success: false, error: "Campaign name is required" };
  if (!isOneOf(PLATFORMS, platform)) return { success: false, error: "Select a platform" };
  if (!isOneOf(STATUSES, status)) return { success: false, error: "Invalid status" };

  if (startDate && endDate && endDate < startDate) {
    return { success: false, error: "End date must be on or after start date" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("campaigns").insert({
    tenant_slug: tenant.slug,
    name,
    platform,
    status,
    spend: num(formData, "spend"),
    revenue: num(formData, "revenue"),
    impressions: Math.floor(num(formData, "impressions")),
    clicks: Math.floor(num(formData, "clicks")),
    conversions: Math.floor(num(formData, "conversions")),
    start_date: startDate,
    end_date: endDate,
    notes,
    created_by: user.id,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/ads-tracker");
  return { success: true };
}

export async function updateCampaignStatus(campaignId: string, status: string) {
  await requireUser();
  if (!isOneOf(STATUSES, status)) {
    return { success: false, error: "Invalid status" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("campaigns").update({ status }).eq("id", campaignId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/ads-tracker");
  return { success: true };
}

export async function deleteCampaign(campaignId: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("campaigns").delete().eq("id", campaignId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/ads-tracker");
  return { success: true };
}
