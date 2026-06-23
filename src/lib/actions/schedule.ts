"use server";

import { requireUser, getCurrentTenant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueAt, enqueueNow, isQStashConfigured, QSTASH_MAX_DELAY_DAYS } from "@/lib/qstash";
import { appUrl } from "@/lib/integrations/platform-oauth";
import type { OAuthPlatform } from "@/lib/services/platform-connections";

const PLATFORM_LIMITS: Record<OAuthPlatform, number> = {
  x: 280,
  linkedin: 3000,
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
};

export interface SchedulePostParams {
  platform: OAuthPlatform;
  content: string;
  scheduledFor: string; // ISO8601
  sourceDraftId?: string;
}

export async function schedulePost(
  params: SchedulePostParams
): Promise<{ id?: string; error?: string }> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No tenant" };

  if (params.platform === "x") {
    return { error: "X publishing requires a paid developer plan. Copy your draft from the Composer and post manually." };
  }

  const limit = PLATFORM_LIMITS[params.platform];
  if (params.content.length > limit) {
    return { error: `Content exceeds ${params.platform} limit (${params.content.length}/${limit})` };
  }

  const scheduledFor = new Date(params.scheduledFor);
  if (isNaN(scheduledFor.getTime())) return { error: "Invalid scheduledFor date" };
  if (scheduledFor < new Date()) return { error: "Scheduled time is in the past" };

  const admin = createAdminClient();

  // Insert the scheduled_posts row first
  const { data: post, error: insertErr } = await admin
    .from("scheduled_posts")
    .insert({
      tenant_slug: tenant.slug,
      platform: params.platform,
      content: params.content,
      scheduled_for: scheduledFor.toISOString(),
      source_draft_id: params.sourceDraftId ?? null,
      created_by: user.id,
      status: "scheduled",
      source: "composer",
    })
    .select("id")
    .single();

  if (insertErr || !post) return { error: insertErr?.message ?? "Insert failed" };

  // Only enqueue to QStash if within the 7-day window.
  // Posts beyond that are picked up by the schedule-flush cron.
  const daysUntil = (scheduledFor.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (isQStashConfigured() && daysUntil <= QSTASH_MAX_DELAY_DAYS) {
    const webhookUrl = appUrl("/api/webhooks/qstash-publish");

    const msgId = await enqueueAt({
      url: webhookUrl,
      body: {
        scheduledPostId: post.id,
        tenantSlug: tenant.slug,
        platform: params.platform,
      },
      notBefore: scheduledFor,
    });

    await admin
      .from("scheduled_posts")
      .update({ qstash_message_id: msgId })
      .eq("id", post.id);
  }

  return { id: post.id };
}

export async function publishNow(
  params: Omit<SchedulePostParams, "scheduledFor">
): Promise<{ id?: string; error?: string }> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No tenant" };

  const limit = PLATFORM_LIMITS[params.platform];
  if (params.content.length > limit) {
    return { error: `Content exceeds ${params.platform} limit` };
  }

  const admin = createAdminClient();
  const { data: post, error: insertErr } = await admin
    .from("scheduled_posts")
    .insert({
      tenant_slug: tenant.slug,
      platform: params.platform,
      content: params.content,
      scheduled_for: new Date().toISOString(),
      source_draft_id: params.sourceDraftId ?? null,
      created_by: user.id,
      status: "scheduled",
      source: "composer",
    })
    .select("id")
    .single();

  if (insertErr || !post) return { error: insertErr?.message ?? "Insert failed" };

  if (isQStashConfigured()) {
    const webhookUrl = appUrl("/api/webhooks/qstash-publish");
    const msgId = await enqueueNow(webhookUrl, {
      scheduledPostId: post.id,
      tenantSlug: tenant.slug,
      platform: params.platform,
    });
    await admin.from("scheduled_posts").update({ qstash_message_id: msgId }).eq("id", post.id);
  }

  return { id: post.id };
}

export async function cancelScheduledPost(postId: string): Promise<{ error?: string }> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No tenant" };

  const admin = createAdminClient();
  const { error } = await admin
    .from("scheduled_posts")
    .update({ status: "failed", error_message: "Cancelled by user" })
    .eq("id", postId)
    .eq("tenant_slug", tenant.slug)
    .eq("status", "scheduled");

  return error ? { error: error.message } : {};
}

export async function getScheduledPosts(platform?: OAuthPlatform) {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return [];

  const admin = createAdminClient();
  let q = admin
    .from("scheduled_posts")
    .select("*")
    .eq("tenant_slug", tenant.slug)
    .order("scheduled_for", { ascending: true });

  if (platform) q = q.eq("platform", platform);

  const { data } = await q;
  return data ?? [];
}
