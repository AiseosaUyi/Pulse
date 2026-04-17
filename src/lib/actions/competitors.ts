"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant, requireUser } from "@/lib/auth";

const TYPES = ["direct", "aspirational", "adjacent"] as const;
const THREAT_LEVELS = ["high", "medium", "low"] as const;
const PLATFORMS = ["instagram", "tiktok", "twitter", "linkedin", "blog"] as const;

function isOneOf<T extends readonly string[]>(list: T, v: unknown): v is T[number] {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function splitLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createCompetitor(formData: FormData) {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const name = str(formData, "name");
  const website = str(formData, "website");
  const type = formData.get("type");
  const threatLevel = formData.get("threatLevel") ?? "medium";
  const strengths = splitLines(str(formData, "strengths"));
  const weaknesses = splitLines(str(formData, "weaknesses"));

  if (!name) return { success: false, error: "Name is required" };
  if (!isOneOf(TYPES, type)) return { success: false, error: "Select a competitor type" };
  if (!isOneOf(THREAT_LEVELS, threatLevel)) return { success: false, error: "Invalid threat level" };

  const platforms: Array<{
    platform: string;
    handle: string;
    followers: number;
    engagementRate: string;
    lastChecked: string;
  }> = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const p of PLATFORMS) {
    const handle = str(formData, `${p}_handle`);
    const followersRaw = str(formData, `${p}_followers`);
    if (!handle && !followersRaw) continue;
    const followers = Math.max(0, Math.floor(Number(followersRaw) || 0));
    platforms.push({
      platform: p,
      handle,
      followers,
      engagementRate: "—",
      lastChecked: today,
    });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("competitors").insert({
    tenant_id: tenant.slug,
    name,
    website: website || null,
    type,
    threat_level: threatLevel,
    strengths,
    weaknesses,
    platforms,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/competition");
  revalidatePath("/intel-feed");
  return { success: true };
}

export async function deleteCompetitor(competitorId: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("competitors").delete().eq("id", competitorId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/competition");
  revalidatePath("/intel-feed");
  return { success: true };
}
