// Approval-request lifecycle (Part 3 of the /api/v1 + MCP build spec).
// Client-injected throughout — this whole flow is either token-authed
// (the public approval page, no session) or tenant_api_token-authed
// (POST /briefings/send, pulse_send_briefing), never SSR-session-authed,
// so there's no createClient()-based twin to keep in sync with here.

import type { SupabaseClient } from "@supabase/supabase-js";
import { mintApprovalToken, approvalTokenTtlMs } from "@/lib/approvals/token";
import { enqueueAt, enqueueNow, isQStashConfigured, QSTASH_MAX_DELAY_DAYS } from "@/lib/qstash";
import { appUrl } from "@/lib/integrations/platform-oauth";
import { r2PublicUrl } from "@/lib/storage/r2";

export type ApprovalTargetType = "scheduled_post" | "content_brief";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ApprovalDeliveryChannel = "email" | "whatsapp";

export interface ApprovalRequestRow {
  id: string;
  tenantSlug: string;
  targetType: ApprovalTargetType;
  targetId: string;
  status: ApprovalStatus;
  rejectReason: string | null;
  decidedAt: string | null;
  deliveredVia: ApprovalDeliveryChannel;
  deliveredTo: string;
  tokenExpiresAt: string;
  createdAt: string;
}

interface RequestRow {
  id: string;
  tenant_slug: string;
  target_type: ApprovalTargetType;
  target_id: string;
  status: ApprovalStatus;
  reject_reason: string | null;
  decided_at: string | null;
  delivered_via: ApprovalDeliveryChannel;
  delivered_to: string;
  token_expires_at: string;
  created_at: string;
}

function rowTo(row: RequestRow): ApprovalRequestRow {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    targetType: row.target_type,
    targetId: row.target_id,
    status: row.status,
    rejectReason: row.reject_reason,
    decidedAt: row.decided_at,
    deliveredVia: row.delivered_via,
    deliveredTo: row.delivered_to,
    tokenExpiresAt: row.token_expires_at,
    createdAt: row.created_at,
  };
}

export interface CreateApprovalRequestInput {
  targetType: ApprovalTargetType;
  targetId: string;
  deliveredVia: ApprovalDeliveryChannel;
  deliveredTo: string;
  createdBy: string | null;
}

export interface MintedApproval {
  requestId: string;
  token: string;
  url: string;
  expiresAt: string;
}

/** Validates the target exists for this tenant, creates the request row,
 * and mints its link. Does NOT send the email/WhatsApp message — the
 * caller (route/MCP tool) owns delivery so a delivery failure doesn't
 * leave an orphaned, un-auditable row. */
export async function createApprovalRequest(
  client: SupabaseClient,
  tenantSlug: string,
  input: CreateApprovalRequestInput
): Promise<MintedApproval | { error: string }> {
  const targetOk =
    input.targetType === "scheduled_post"
      ? await targetScheduledPostExists(client, tenantSlug, input.targetId)
      : await targetBriefExists(client, tenantSlug, input.targetId);
  if (!targetOk) return { error: `${input.targetType} not found` };

  const expiresAt = new Date(Date.now() + approvalTokenTtlMs()).toISOString();
  const { data, error } = await client
    .from("approval_requests")
    .insert({
      tenant_slug: tenantSlug,
      target_type: input.targetType,
      target_id: input.targetId,
      delivered_via: input.deliveredVia,
      delivered_to: input.deliveredTo,
      token_expires_at: expiresAt,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Insert failed" };

  const token = await mintApprovalToken(data.id);
  return {
    requestId: data.id,
    token,
    url: appUrl(`/approve/${token}`),
    expiresAt,
  };
}

async function targetScheduledPostExists(
  client: SupabaseClient,
  tenantSlug: string,
  id: string
): Promise<boolean> {
  const { data } = await client
    .from("scheduled_posts")
    .select("id")
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .maybeSingle();
  return Boolean(data);
}

async function targetBriefExists(
  client: SupabaseClient,
  tenantSlug: string,
  id: string
): Promise<boolean> {
  const { data } = await client
    .from("content_briefs")
    .select("id")
    .eq("tenant_id", tenantSlug)
    .eq("id", id)
    .maybeSingle();
  return Boolean(data);
}

export interface ScheduledPostApprovalTarget {
  type: "scheduled_post";
  id: string;
  platform: string;
  content: string;
  mediaPaths: string[];
  scheduledFor: string;
  status: string;
}

export interface BriefApprovalTarget {
  type: "content_brief";
  id: string;
  title: string;
  platform: string;
  contentType: string;
  outline: string[];
  draftContent: string;
  status: string;
}

export type ApprovalTarget = ScheduledPostApprovalTarget | BriefApprovalTarget;

export type ApprovalContext =
  | { state: "ready"; request: ApprovalRequestRow; target: ApprovalTarget }
  | { state: "expired"; request: ApprovalRequestRow; target: ApprovalTarget }
  | { state: "already_actioned"; request: ApprovalRequestRow; target: ApprovalTarget }
  | { state: "not_found" };

/** Resolves a request id (already verified from the JWT by the caller) to
 * its full render context — the request row, its target content, and
 * which of the page's terminal/interactive states applies. Expiry is
 * computed here (not stored) per migration 091's comment. */
export async function getApprovalContext(
  client: SupabaseClient,
  requestId: string
): Promise<ApprovalContext> {
  const { data: reqRow } = await client
    .from("approval_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (!reqRow) return { state: "not_found" };
  const request = rowTo(reqRow as RequestRow);

  const target =
    request.targetType === "scheduled_post"
      ? await loadScheduledPostTarget(client, request.targetId)
      : await loadBriefTarget(client, request.targetId);
  if (!target) return { state: "not_found" };

  if (request.status !== "pending") return { state: "already_actioned", request, target };
  if (new Date(request.tokenExpiresAt).getTime() < Date.now()) {
    return { state: "expired", request, target };
  }
  return { state: "ready", request, target };
}

async function loadScheduledPostTarget(
  client: SupabaseClient,
  id: string
): Promise<ScheduledPostApprovalTarget | null> {
  const { data } = await client
    .from("scheduled_posts")
    .select("id, platform, content, media_paths, scheduled_for, status")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    type: "scheduled_post",
    id: data.id,
    platform: data.platform,
    content: data.content,
    // Resolved to public URLs here (not the raw R2 key) so the page can
    // render an <img> directly — same public-bucket-URL model
    // GET /api/v1/media/*path already documents (no per-object signing
    // exists in this codebase).
    mediaPaths: (data.media_paths ?? []).flatMap((key: string) => {
      try {
        return [r2PublicUrl(key)];
      } catch {
        return [];
      }
    }),
    scheduledFor: data.scheduled_for,
    status: data.status,
  };
}

async function loadBriefTarget(
  client: SupabaseClient,
  id: string
): Promise<BriefApprovalTarget | null> {
  const { data } = await client
    .from("content_briefs")
    .select("id, title, platform, content_type, outline, draft_content, status")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  return {
    type: "content_brief",
    id: data.id,
    title: data.title,
    platform: data.platform,
    contentType: data.content_type,
    outline: data.outline ?? [],
    draftContent: data.draft_content ?? "",
    status: data.status,
  };
}

export interface DecideApprovalInput {
  action: "approve" | "reject";
  editedContent?: string;
  rejectReason?: string;
}

export type DecideApprovalResult =
  | { ok: true; target: ApprovalTarget }
  | { ok: false; error: string; status: 404 | 409 | 410 | 500 };

/** The single state-transition entrypoint for both approve and reject,
 * across both target types. Re-derives context so a raced double-submit
 * (two tabs, a retried request) can't double-decide — the conditional
 * UPDATE below is the actual concurrency guard, this is just the 404/409
 * classification around it. */
export async function decideApproval(
  client: SupabaseClient,
  requestId: string,
  input: DecideApprovalInput
): Promise<DecideApprovalResult> {
  const { data: reqRow } = await client
    .from("approval_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();
  if (!reqRow) return { ok: false, error: "Approval request not found", status: 404 };
  const request = rowTo(reqRow as RequestRow);

  if (new Date(request.tokenExpiresAt).getTime() < Date.now()) {
    return { ok: false, error: "This link expired", status: 410 };
  }

  // Conditional UPDATE (status = 'pending') is the real concurrency guard —
  // zero rows affected means someone else's decision won the race.
  const newStatus = input.action === "approve" ? "approved" : "rejected";
  const { data: updated, error } = await client
    .from("approval_requests")
    .update({
      status: newStatus,
      reject_reason: input.action === "reject" ? input.rejectReason?.trim() || null : null,
      decided_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: error.message, status: 500 };
  if (!updated || updated.length === 0) {
    return { ok: false, error: "Already actioned", status: 409 };
  }

  const target =
    request.targetType === "scheduled_post"
      ? await applyToScheduledPost(client, request, input)
      : await applyToBrief(client, request, input);
  if (!target) return { ok: false, error: "Target not found", status: 404 };

  return { ok: true, target };
}

async function applyToScheduledPost(
  client: SupabaseClient,
  request: ApprovalRequestRow,
  input: DecideApprovalInput
): Promise<ScheduledPostApprovalTarget | null> {
  if (input.action === "reject") {
    await client
      .from("scheduled_posts")
      .update({
        status: "failed",
        error_message: `Rejected via approval link${input.rejectReason ? `: ${input.rejectReason.trim()}` : ""}`,
      })
      .eq("id", request.targetId);
    return loadScheduledPostTarget(client, request.targetId);
  }

  // Approve: persist an edit if one was made, then promote draft -> scheduled
  // and enqueue via the same QStash path schedulePost()/publishNow() use —
  // this IS "auto-publish-on-approve" (the daily due-query only ever sees
  // status='scheduled' rows; a 'draft' row is invisible to it until here).
  if (input.editedContent?.trim()) {
    await client
      .from("scheduled_posts")
      .update({ content: input.editedContent.trim() })
      .eq("id", request.targetId);
  }

  const { data: post } = await client
    .from("scheduled_posts")
    .select("id, tenant_slug, platform, scheduled_for, status")
    .eq("id", request.targetId)
    .maybeSingle();

  if (post && post.status === "draft") {
    const scheduledFor = new Date(post.scheduled_for);
    const isDue = scheduledFor.getTime() <= Date.now();
    await client.from("scheduled_posts").update({ status: "scheduled" }).eq("id", post.id);

    if (isQStashConfigured()) {
      const webhookUrl = appUrl("/api/webhooks/qstash-publish");
      const daysUntil = (scheduledFor.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      // Non-fatal: the approval decision itself (the DB transition above)
      // must not be rolled back or 500 the request just because the QStash
      // API call hiccups. For a not-yet-due post this mirrors
      // schedule-flush's own "non-fatal — will retry next cron run" —
      // that cron re-enqueues any status='scheduled' row with no
      // qstash_message_id inside the 7-day window. It does NOT cover an
      // already-due post whose immediate enqueueNow() failed here
      // (schedule-flush's query excludes scheduled_for in the past) — a
      // real gap, tracked in TODOS.md, not silently swallowed.
      try {
        const msgId = isDue
          ? await enqueueNow(webhookUrl, {
              scheduledPostId: post.id,
              tenantSlug: post.tenant_slug,
              platform: post.platform,
            })
          : daysUntil <= QSTASH_MAX_DELAY_DAYS
            ? await enqueueAt({
                url: webhookUrl,
                body: { scheduledPostId: post.id, tenantSlug: post.tenant_slug, platform: post.platform },
                notBefore: scheduledFor,
              })
            : null; // beyond the QStash window — schedule-flush cron picks it up
        if (msgId) {
          await client.from("scheduled_posts").update({ qstash_message_id: msgId }).eq("id", post.id);
        }
      } catch {
        /* approval still succeeds — see comment above */
      }
    }
  }

  return loadScheduledPostTarget(client, request.targetId);
}

async function applyToBrief(
  client: SupabaseClient,
  request: ApprovalRequestRow,
  input: DecideApprovalInput
): Promise<BriefApprovalTarget | null> {
  if (input.action === "reject") {
    await client
      .from("content_briefs")
      .update({
        status: "dismissed",
        dismissed_at: new Date().toISOString(),
        dismissed_reason: input.rejectReason?.trim() || null,
      })
      .eq("id", request.targetId);
    return loadBriefTarget(client, request.targetId);
  }

  if (input.editedContent?.trim()) {
    await client
      .from("content_briefs")
      .update({ draft_content: input.editedContent.trim() })
      .eq("id", request.targetId);
  }
  await client.from("content_briefs").update({ status: "approved" }).eq("id", request.targetId);
  return loadBriefTarget(client, request.targetId);
}

export interface PendingApprovalSummary {
  id: string;
  targetType: ApprovalTargetType;
  targetId: string;
  deliveredVia: ApprovalDeliveryChannel;
  deliveredTo: string;
  tokenExpiresAt: string;
  createdAt: string;
}

export async function listPendingApprovals(
  client: SupabaseClient,
  tenantSlug: string
): Promise<PendingApprovalSummary[]> {
  const { data } = await client
    .from("approval_requests")
    .select("id, target_type, target_id, delivered_via, delivered_to, token_expires_at, created_at")
    .eq("tenant_slug", tenantSlug)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []).map((r) => ({
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    deliveredVia: r.delivered_via,
    deliveredTo: r.delivered_to,
    tokenExpiresAt: r.token_expires_at,
    createdAt: r.created_at,
  }));
}
