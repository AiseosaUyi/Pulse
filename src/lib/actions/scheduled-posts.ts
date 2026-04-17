"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ScheduledPostStatus } from "@/lib/types/scheduled-posts";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

interface ScheduleInput {
  briefId?: string | null;
  platform: string;
  contentType?: string | null;
  caption?: string | null;
  bestTime?: string | null;
  scheduledFor: string;
  status?: ScheduledPostStatus;
  notes?: string | null;
}

export async function scheduleBriefPost(
  tenantSlug: string,
  input: ScheduleInput
): Promise<ActionResult<{ id: string }>> {
  if (!input.platform || !input.scheduledFor) {
    return { success: false, error: "Platform and date are required" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scheduled_posts")
    .insert({
      tenant_slug: tenantSlug,
      brief_id: input.briefId ?? null,
      platform: input.platform,
      content_type: input.contentType ?? null,
      caption: input.caption ?? null,
      best_time: input.bestTime ?? null,
      scheduled_for: input.scheduledFor,
      status: input.status ?? "scheduled",
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };
  revalidatePath("/ai-content");
  return { success: true, id: data.id };
}

export async function updateScheduledPostStatus(
  tenantSlug: string,
  id: string,
  status: ScheduledPostStatus
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("scheduled_posts")
    .update({ status })
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/ai-content");
  return { success: true };
}

export async function deleteScheduledPost(
  tenantSlug: string,
  id: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("scheduled_posts")
    .delete()
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/ai-content");
  return { success: true };
}
