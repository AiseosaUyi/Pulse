"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant, requireUser } from "@/lib/auth";

const TYPES = ["dm", "comment", "mention", "reply"] as const;
const PLATFORMS = ["instagram", "tiktok", "twitter", "linkedin"] as const;
const SENTIMENTS = ["positive", "neutral", "negative", "question"] as const;

function isOneOf<T extends readonly string[]>(list: T, v: unknown): v is T[number] {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function createEngagementItem(formData: FormData) {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const type = formData.get("type");
  const platform = formData.get("platform");
  const sentiment = formData.get("sentiment") ?? "neutral";
  const fromName = str(formData, "fromName");
  const fromHandle = str(formData, "fromHandle") || null;
  const fromAvatar = str(formData, "fromAvatar") || null;
  const content = str(formData, "content");
  const postTitle = str(formData, "postTitle") || null;
  const externalUrl = str(formData, "externalUrl") || null;

  if (!isOneOf(TYPES, type)) return { success: false, error: "Select a type" };
  if (!isOneOf(PLATFORMS, platform)) return { success: false, error: "Select a platform" };
  if (!isOneOf(SENTIMENTS, sentiment)) return { success: false, error: "Invalid sentiment" };
  if (!fromName) return { success: false, error: "Sender name is required" };
  if (!content) return { success: false, error: "Message content is required" };

  const supabase = await createClient();
  const { error } = await supabase.from("engagement_items").insert({
    tenant_slug: tenant.slug,
    type,
    platform,
    from_name: fromName,
    from_handle: fromHandle,
    from_avatar: fromAvatar,
    content,
    post_title: postTitle,
    external_url: externalUrl,
    sentiment,
    created_by: user.id,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/engagement");
  return { success: true };
}

export async function markAsRead(itemId: string, read: boolean) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("engagement_items")
    .update({ read })
    .eq("id", itemId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/engagement");
  return { success: true };
}

export async function markAsReplied(itemId: string, replied: boolean) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("engagement_items")
    .update({ replied, read: true })
    .eq("id", itemId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/engagement");
  return { success: true };
}

export async function deleteEngagementItem(itemId: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase
    .from("engagement_items")
    .delete()
    .eq("id", itemId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/engagement");
  return { success: true };
}
