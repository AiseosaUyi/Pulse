"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getTenant } from "@/lib/services/tenants";
import { getBrandContext } from "@/lib/ai/brand-positioning";
import { getOutboundFilters } from "@/lib/server/outbound-filters";
import { getProspect, listProspects } from "@/lib/services/outbound";
import {
  draftOutboundDmAi,
  qualifyProspectAi,
  OutboundAiError,
} from "@/lib/ai/outbound";
import type {
  OutboundPlatform,
  ProspectRecord,
  ProspectStatus,
  OutboundDmStatus,
  SignalType,
} from "@/lib/types/outbound";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export interface CreateProspectInput {
  platform: OutboundPlatform;
  handle: string;
  displayName?: string;
  profileUrl?: string;
  bio?: string;
  followerCount?: number;
  signalSummary?: string;
  signalType?: SignalType;
  searchId?: string;
}

function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "").toLowerCase();
}

export async function createProspect(
  tenantSlug: string,
  input: CreateProspectInput
): Promise<ActionResult<{ prospect: ProspectRecord }>> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const handle = normalizeHandle(input.handle);
  if (!handle) return { success: false, error: "Handle is required" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prospects")
    .upsert(
      {
        tenant_slug: tenantSlug,
        platform: input.platform,
        handle,
        display_name: input.displayName ?? null,
        profile_url: input.profileUrl ?? null,
        bio: input.bio ?? null,
        follower_count: input.followerCount ?? null,
        signal_summary: input.signalSummary ?? null,
        signal_data: input.signalType ? { signal_type: input.signalType } : {},
        search_id: input.searchId ?? null,
        status: "new",
        created_by: user.id,
      },
      { onConflict: "tenant_slug,platform,handle" }
    )
    .select("*")
    .maybeSingle();
  if (error || !data) {
    return { success: false, error: error?.message ?? "Insert failed" };
  }

  revalidatePath("/leads");
  return {
    success: true,
    prospect: {
      id: data.id,
      tenantSlug: data.tenant_slug,
      searchId: data.search_id,
      platform: data.platform,
      handle: data.handle,
      displayName: data.display_name,
      profileUrl: data.profile_url,
      avatarUrl: data.avatar_url,
      bio: data.bio,
      followerCount: data.follower_count,
      signalSummary: data.signal_summary,
      signalData: (data.signal_data ?? {}) as Record<string, unknown>,
      qualificationScore: data.qualification_score,
      qualificationReason: data.qualification_reason,
      status: data.status,
      notes: data.notes,
      category: data.category ?? null,
      location: data.location ?? null,
      verifiedName: data.verified_name ?? null,
      eventTitle: data.event_title ?? null,
      phone: data.phone ?? null,
      lastReachoutAt: data.last_reachout_at ?? null,
      lastTouchedAt: data.last_touched_at,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  };
}

/**
 * Bulk AI-qualify every prospect currently in `new` status for the
 * tenant. Capped to avoid runaway cost + Vercel 300s limit; returns
 * a summary so the UI can toast progress.
 */
export async function bulkQualifyNewProspects(
  tenantSlug: string,
  limit = 25
): Promise<
  ActionResult<{ scored: number; qualified: number; skipped: number }>
> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("prospects")
    .select("id")
    .eq("tenant_slug", tenantSlug)
    .eq("status", "new")
    .order("created_at", { ascending: false })
    .limit(limit);

  const ids = (rows ?? []).map((r) => r.id as string);
  if (ids.length === 0) {
    return { success: true, scored: 0, qualified: 0, skipped: 0 };
  }

  let scored = 0;
  let qualified = 0;
  let skipped = 0;
  for (const id of ids) {
    const res = await qualifyProspect(tenantSlug, id);
    if (!res.success) {
      skipped += 1;
      continue;
    }
    scored += 1;
    if (res.status === "qualified") qualified += 1;
  }

  revalidatePath("/leads");
  return { success: true, scored, qualified, skipped };
}

export async function qualifyProspect(
  tenantSlug: string,
  prospectId: string
): Promise<ActionResult<{ score: number; status: ProspectStatus }>> {
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };
  const prospect = await getProspect(tenantSlug, prospectId);
  if (!prospect) return { success: false, error: "Prospect not found" };

  const supabase = await createClient();
  // Mark qualifying immediately so the UI can show a spinner.
  await supabase
    .from("prospects")
    .update({ status: "qualifying" })
    .eq("tenant_slug", tenantSlug)
    .eq("id", prospectId);

  try {
    const [{ voice, positioning }, filters] = await Promise.all([
      getBrandContext(tenantSlug),
      getOutboundFilters(tenantSlug),
    ]);
    const { result } = await qualifyProspectAi({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      positioning,
      filters,
      prospect,
    });

    const nextStatus: ProspectStatus = result.should_reach_out
      ? "qualified"
      : "unqualified";
    await supabase
      .from("prospects")
      .update({
        status: nextStatus,
        qualification_score: result.score,
        qualification_reason: `${result.persona} · ${result.reason}`,
        last_touched_at: new Date().toISOString(),
      })
      .eq("tenant_slug", tenantSlug)
      .eq("id", prospectId);

    revalidatePath("/leads");
    return { success: true, score: result.score, status: nextStatus };
  } catch (err) {
    await supabase
      .from("prospects")
      .update({ status: "new" })
      .eq("tenant_slug", tenantSlug)
      .eq("id", prospectId);
    const msg =
      err instanceof OutboundAiError
        ? "Qualifier failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { success: false, error: msg };
  }
}

export async function draftProspectDm(
  tenantSlug: string,
  prospectId: string,
  context?: string
): Promise<ActionResult<{ dmId: string; body: string }>> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const tenant = await getTenant(tenantSlug);
  if (!tenant) return { success: false, error: "Tenant not found" };
  const prospect = await getProspect(tenantSlug, prospectId);
  if (!prospect) return { success: false, error: "Prospect not found" };

  try {
    const { voice, positioning } = await getBrandContext(tenantSlug);
    const { result, model, costUsd } = await draftOutboundDmAi({
      tenantSlug,
      tenantName: tenant.name,
      voice,
      positioning,
      prospect,
      context,
    });

    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("outbound_dms")
      .select("version")
      .eq("tenant_slug", tenantSlug)
      .eq("prospect_id", prospectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = ((existing?.version as number | null) ?? 0) + 1;

    const { data, error } = await supabase
      .from("outbound_dms")
      .insert({
        tenant_slug: tenantSlug,
        prospect_id: prospectId,
        version: nextVersion,
        body: result.body,
        followup_body: result.followup_body,
        status: "drafted",
        generator_model: model,
        generator_cost_usd: costUsd,
        created_by: user.id,
      })
      .select("id, body")
      .single();
    if (error || !data) {
      return { success: false, error: error?.message ?? "Draft save failed" };
    }

    await supabase
      .from("prospects")
      .update({
        status: "drafted",
        last_touched_at: new Date().toISOString(),
      })
      .eq("tenant_slug", tenantSlug)
      .eq("id", prospectId);

    revalidatePath("/leads");
    return { success: true, dmId: data.id, body: data.body };
  } catch (err) {
    const msg =
      err instanceof OutboundAiError
        ? "DM draft failed. Please try again."
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return { success: false, error: msg };
  }
}

export async function updateOutboundDm(
  tenantSlug: string,
  id: string,
  input: { body?: string; status?: OutboundDmStatus }
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const supabase = await createClient();
  const patch: Record<string, unknown> = {};
  if (input.body !== undefined) patch.body = input.body;
  if (input.status !== undefined) {
    patch.status = input.status;
    if (input.status === "approved") {
      patch.approved_by = user.id;
      patch.approved_at = new Date().toISOString();
    }
    if (input.status === "sent") {
      patch.sent_at = new Date().toISOString();
    }
  }
  if (Object.keys(patch).length === 0) return { success: false, error: "No change" };

  const { data, error } = await supabase
    .from("outbound_dms")
    .update(patch)
    .eq("tenant_slug", tenantSlug)
    .eq("id", id)
    .select("prospect_id, status")
    .maybeSingle();
  if (error || !data) {
    return { success: false, error: error?.message ?? "Update failed" };
  }

  // Cascade the prospect's pipeline stage when the DM status advances.
  const prospectStatus: ProspectStatus | null =
    data.status === "approved"
      ? "approved"
      : data.status === "sent"
        ? "sent"
        : data.status === "replied"
          ? "replied"
          : null;
  if (prospectStatus) {
    await supabase
      .from("prospects")
      .update({
        status: prospectStatus,
        last_touched_at: new Date().toISOString(),
      })
      .eq("tenant_slug", tenantSlug)
      .eq("id", data.prospect_id);
  }

  revalidatePath("/leads");
  return { success: true };
}

export async function updateProspectStatus(
  tenantSlug: string,
  id: string,
  status: ProspectStatus,
  notes?: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const patch: Record<string, unknown> = {
    status,
    last_touched_at: new Date().toISOString(),
  };
  if (notes !== undefined) patch.notes = notes;
  const { error } = await supabase
    .from("prospects")
    .update(patch)
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}

export async function deleteProspect(
  tenantSlug: string,
  id: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("prospects")
    .delete()
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}

export async function updateProspect(
  tenantSlug: string,
  id: string,
  patch: {
    handle?: string;
    platform?: OutboundPlatform;
    displayName?: string | null;
    bio?: string | null;
    notes?: string | null;
    profileUrl?: string | null;
    followerCount?: number | null;
    category?: string | null;
    location?: string | null;
    verifiedName?: string | null;
    eventTitle?: string | null;
    lastReachoutAt?: string | null;
  }
): Promise<ActionResult> {
  const supabase = await createClient();
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.handle !== undefined) update.handle = patch.handle.replace(/^@/, "").trim().toLowerCase();
  if (patch.platform !== undefined) update.platform = patch.platform;
  if (patch.displayName !== undefined) update.display_name = patch.displayName;
  if (patch.bio !== undefined) update.bio = patch.bio;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.profileUrl !== undefined) update.profile_url = patch.profileUrl;
  if (patch.followerCount !== undefined) update.follower_count = patch.followerCount;
  if (patch.category !== undefined) update.category = patch.category;
  if (patch.location !== undefined) update.location = patch.location;
  if (patch.verifiedName !== undefined) update.verified_name = patch.verifiedName;
  if (patch.eventTitle !== undefined) update.event_title = patch.eventTitle;
  if (patch.lastReachoutAt !== undefined) update.last_reachout_at = patch.lastReachoutAt;
  const { error } = await supabase
    .from("prospects")
    .update(update)
    .eq("tenant_slug", tenantSlug)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}

export async function fetchProspectsPage(
  tenantSlug: string,
  page: number,
  statusFilter?: string
): Promise<{ data: import("@/lib/types/outbound").ProspectRecord[]; total: number }> {
  const user = await getCurrentUser();
  if (!user) return { data: [], total: 0 };
  return listProspects(tenantSlug, {
    page,
    pageSize: 50,
    status: (statusFilter === "all" ? undefined : statusFilter) as import("@/lib/types/outbound").ProspectStatus | undefined,
  });
}

export async function bulkDeleteProspects(
  tenantSlug: string,
  ids: string[]
): Promise<ActionResult<{ deleted: number }>> {
  if (!ids.length) return { success: true, deleted: 0 };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("prospects")
    .delete({ count: "exact" })
    .eq("tenant_slug", tenantSlug)
    .in("id", ids);
  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true, deleted: count ?? ids.length };
}

export async function bulkUpdateProspectStatus(
  tenantSlug: string,
  ids: string[],
  status: ProspectStatus
): Promise<ActionResult<{ updated: number }>> {
  if (!ids.length) return { success: true, updated: 0 };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("prospects")
    .update({ status, last_touched_at: new Date().toISOString() })
    .eq("tenant_slug", tenantSlug)
    .in("id", ids)
    .select("id");
  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true, updated: ids.length };
}

/**
 * Mark an inbound message read. Used when the operator opens the
 * conversation in the inbox.
 */
export async function markInboundRead(
  tenantSlug: string,
  messageId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("inbound_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_slug", tenantSlug)
    .eq("id", messageId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}

/**
 * Manually record a reply (while we wait on the IG Messenger webhook
 * + TikTok polling). Lets the operator mirror a reply they saw on
 * their phone into Pulse so the inbox stays useful.
 */
export async function recordInboundReply(
  tenantSlug: string,
  prospectId: string,
  input: { body: string; inReplyToDmId?: string }
): Promise<ActionResult> {
  if (!input.body.trim()) return { success: false, error: "Body required" };
  const prospect = await getProspect(tenantSlug, prospectId);
  if (!prospect) return { success: false, error: "Prospect not found" };

  const supabase = await createClient();
  const { error } = await supabase.from("inbound_messages").insert({
    tenant_slug: tenantSlug,
    prospect_id: prospectId,
    in_reply_to_dm_id: input.inReplyToDmId ?? null,
    platform: prospect.platform,
    body: input.body.trim(),
  });
  if (error) return { success: false, error: error.message };

  // Advance the prospect + the related DM.
  await supabase
    .from("prospects")
    .update({
      status: "replied",
      last_touched_at: new Date().toISOString(),
    })
    .eq("tenant_slug", tenantSlug)
    .eq("id", prospectId);
  if (input.inReplyToDmId) {
    await supabase
      .from("outbound_dms")
      .update({ status: "replied" })
      .eq("tenant_slug", tenantSlug)
      .eq("id", input.inReplyToDmId);
  }

  revalidatePath("/leads");
  return { success: true };
}
