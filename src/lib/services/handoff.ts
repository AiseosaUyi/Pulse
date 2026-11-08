import type { SupabaseClient } from "@supabase/supabase-js";

export type HandoffPlatform = "instagram" | "tiktok" | "twitter" | "linkedin";
export type HandoffChannel = "whatsapp" | "phone" | "email" | "in_person" | "other";

export interface HandoffMovedBy {
  id: string;
  name: string;
}

export interface ConversationHandoff {
  id: string;
  tenantId: string;
  tenantSlug: string;
  platform: string;
  threadExternalId: string;
  channel: string;
  contact: string | null;
  note: string | null;
  movedBy: string;
  movedAt: string;
  clearedAt: string | null;
  clearedBy: string | null;
}

export interface HandoffSummary {
  channel: string;
  contact: string | null;
  note: string | null;
  movedBy: HandoffMovedBy;
  movedAt: string;
}

export interface MarkHandoffInput {
  platform: string;
  threadExternalId: string;
  channel: string;
  contact?: string | null;
  note?: string | null;
  movedBy?: string | null;
}

export interface ClearHandoffInput {
  platform: string;
  threadExternalId: string;
  clearedBy?: string | null;
}

export const DEFAULT_HANDOFF_STALE_DAYS = 14;

export const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  phone: "Phone",
  email: "Email",
  in_person: "In Person",
  other: "Other",
};

/**
 * Derives threadExternalId from externalId:
 * e.g. ig:dm:<threadId>:<messageId> -> ig:dm:<threadId>
 *      ig:comment:<shortcode>:<commentId> -> ig:comment:<shortcode>
 *      ig:dm:<threadId> -> ig:dm:<threadId>
 */
export function parseThreadExternalId(externalId: string | null | undefined): string | null {
  if (!externalId) return null;
  const parts = externalId.split(":");
  if (parts.length >= 4) {
    return parts.slice(0, 3).join(":");
  }
  return externalId;
}

/**
 * Returns true if handoff moved_at is older than staleAfterDays (default 14).
 */
export function isHandoffStale(
  movedAt: string,
  staleAfterDays: number = DEFAULT_HANDOFF_STALE_DAYS,
  referenceDate: Date = new Date()
): boolean {
  const movedTime = new Date(movedAt).getTime();
  if (Number.isNaN(movedTime)) return false;
  const diffDays = (referenceDate.getTime() - movedTime) / (1000 * 60 * 60 * 24);
  return diffDays >= staleAfterDays;
}

/**
 * Formats a handoff badge label, e.g. "On WhatsApp · Priye · 6 Nov"
 */
export function formatHandoffBadge(handoff: HandoffSummary): string {
  const channelLabel = CHANNEL_LABELS[handoff.channel.toLowerCase()] ?? handoff.channel;
  const personName = handoff.movedBy?.name ?? "Team member";
  const dateObj = new Date(handoff.movedAt);
  const dateStr = Number.isNaN(dateObj.getTime())
    ? ""
    : dateObj.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  return `On ${channelLabel} · ${personName}${dateStr ? ` · ${dateStr}` : ""}`;
}

export async function getTenantHandoffStaleDays(
  client: SupabaseClient,
  tenantSlug: string
): Promise<number> {
  const { data } = await client
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();

  const settings = (data?.settings as Record<string, unknown> | null) ?? {};
  if (typeof settings.handoffStaleAfterDays === "number") {
    return settings.handoffStaleAfterDays;
  }
  return DEFAULT_HANDOFF_STALE_DAYS;
}

/**
 * Resolves a team_people person id from input, user id, or tenant default.
 */
export async function resolvePersonId(
  client: SupabaseClient,
  tenantSlug: string,
  preferredIdOrName?: string | null,
  userId?: string | null
): Promise<{ id: string; name: string }> {
  // 1. Try preferred identifier (id or name)
  if (preferredIdOrName && preferredIdOrName.trim()) {
    const trimmed = preferredIdOrName.trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    const query = isUuid
      ? client.from("team_people").select("id, name").eq("tenant_slug", tenantSlug).eq("id", trimmed)
      : client.from("team_people").select("id, name").eq("tenant_slug", tenantSlug).ilike("name", trimmed);

    const { data: person } = await query.maybeSingle();
    if (person) return { id: person.id, name: person.name };

    // If it is already a UUID, we can return it even if not in team_people (e.g. mock test)
    if (isUuid) {
      return { id: trimmed, name: "Team member" };
    }
  }

  // 2. Try auth userId
  if (userId) {
    const { data: person } = await client
      .from("team_people")
      .select("id, name")
      .eq("tenant_slug", tenantSlug)
      .eq("user_id", userId)
      .maybeSingle();
    if (person) return { id: person.id, name: person.name };
  }

  // 3. Fallback to any active team_people member for the tenant
  const { data: fallbackPerson } = await client
    .from("team_people")
    .select("id, name")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fallbackPerson) {
    return { id: fallbackPerson.id, name: fallbackPerson.name };
  }

  // 4. Default dummy UUID if no team_people exist yet
  return { id: "00000000-0000-0000-0000-000000000001", name: "Team member" };
}

/**
 * Upserts the active handoff for a thread and moves open rows to handed_off.
 */
export async function markHandoff(
  client: SupabaseClient,
  tenantSlug: string,
  input: MarkHandoffInput
): Promise<{ ok: true; handoff: HandoffSummary } | { ok: false; error: string }> {
  if (!input.platform) return { ok: false, error: "Platform is required" };
  if (!input.threadExternalId) return { ok: false, error: "Thread external ID is required" };
  if (!input.channel) return { ok: false, error: "Channel is required" };

  const person = await resolvePersonId(client, tenantSlug, input.movedBy);
  const nowIso = new Date().toISOString();

  // Find existing active handoff
  const { data: existing } = await client
    .from("conversation_handoffs")
    .select("id")
    .eq("tenant_slug", tenantSlug)
    .eq("platform", input.platform)
    .eq("thread_external_id", input.threadExternalId)
    .is("cleared_at", null)
    .maybeSingle();

  let handoffId: string;
  if (existing) {
    handoffId = existing.id;
    const { error: updateErr } = await client
      .from("conversation_handoffs")
      .update({
        channel: input.channel,
        contact: input.contact ?? null,
        note: input.note ?? null,
        moved_by: person.id,
        moved_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", existing.id);
    if (updateErr) return { ok: false, error: updateErr.message };
  } else {
    const { data: inserted, error: insertErr } = await client
      .from("conversation_handoffs")
      .insert({
        tenant_id: tenantSlug,
        tenant_slug: tenantSlug,
        platform: input.platform,
        thread_external_id: input.threadExternalId,
        channel: input.channel,
        contact: input.contact ?? null,
        note: input.note ?? null,
        moved_by: person.id,
        moved_at: nowIso,
      })
      .select("id")
      .single();
    if (insertErr || !inserted) return { ok: false, error: insertErr?.message ?? "Insert failed" };
    handoffId = inserted.id;
  }

  // Marking a handoff sets every OPEN row in that thread to handed_off
  const { error: rowsErr } = await client
    .from("engagement_items")
    .update({ status: "handed_off" })
    .eq("tenant_slug", tenantSlug)
    .eq("platform", input.platform)
    .eq("thread_external_id", input.threadExternalId)
    .eq("status", "open");

  if (rowsErr) {
    // Non-fatal, but return warning / error message if needed
    console.error("Failed to cascade handed_off to open rows:", rowsErr.message);
  }

  return {
    ok: true,
    handoff: {
      channel: input.channel,
      contact: input.contact ?? null,
      note: input.note ?? null,
      movedBy: person,
      movedAt: nowIso,
    },
  };
}

/**
 * Clears an active handoff (sets cleared_at and cleared_by).
 * Does NOT auto-reopen rows.
 */
export async function clearHandoff(
  client: SupabaseClient,
  tenantSlug: string,
  input: ClearHandoffInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!input.platform) return { ok: false, error: "Platform is required" };
  if (!input.threadExternalId) return { ok: false, error: "Thread external ID is required" };

  const person = await resolvePersonId(client, tenantSlug, input.clearedBy);
  const nowIso = new Date().toISOString();

  const { error } = await client
    .from("conversation_handoffs")
    .update({
      cleared_at: nowIso,
      cleared_by: person.id,
      updated_at: nowIso,
    })
    .eq("tenant_slug", tenantSlug)
    .eq("platform", input.platform)
    .eq("thread_external_id", input.threadExternalId)
    .is("cleared_at", null);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Retrieves the active handoff for a thread, or null if none active.
 */
export async function getActiveHandoff(
  client: SupabaseClient,
  tenantSlug: string,
  platform: string,
  threadExternalId: string | null
): Promise<HandoffSummary | null> {
  if (!platform || !threadExternalId) return null;

  const { data: row } = await client
    .from("conversation_handoffs")
    .select("channel, contact, note, moved_by, moved_at")
    .eq("tenant_slug", tenantSlug)
    .eq("platform", platform)
    .eq("thread_external_id", threadExternalId)
    .is("cleared_at", null)
    .maybeSingle();

  if (!row) return null;

  const { data: person } = await client
    .from("team_people")
    .select("id, name")
    .eq("tenant_slug", tenantSlug)
    .eq("id", row.moved_by)
    .maybeSingle();

  return {
    channel: row.channel,
    contact: row.contact,
    note: row.note,
    movedBy: {
      id: row.moved_by,
      name: person?.name ?? "Team member",
    },
    movedAt: row.moved_at,
  };
}

/**
 * Batch resolves active handoffs and stale flags for a list of items.
 */
export async function getActiveHandoffsMap(
  client: SupabaseClient,
  tenantSlug: string,
  threads: Array<{ platform: string; threadExternalId: string }>,
  staleDays?: number
): Promise<Map<string, { handoff: HandoffSummary; isStale: boolean }>> {
  const result = new Map<string, { handoff: HandoffSummary; isStale: boolean }>();
  if (threads.length === 0) return result;

  const resolvedStaleDays = staleDays ?? (await getTenantHandoffStaleDays(client, tenantSlug));
  const distinctThreads = Array.from(new Set(threads.map((t) => `${t.platform}:${t.threadExternalId}`)));
  const threadIds = Array.from(new Set(threads.map((t) => t.threadExternalId)));

  const { data: handoffs, error } = await client
    .from("conversation_handoffs")
    .select("id, platform, thread_external_id, channel, contact, note, moved_by, moved_at")
    .eq("tenant_slug", tenantSlug)
    .in("thread_external_id", threadIds)
    .is("cleared_at", null);

  if (error || !handoffs || handoffs.length === 0) return result;

  // Batch query moved_by person names
  const personIds = Array.from(new Set(handoffs.map((h) => h.moved_by)));
  const { data: people } = await client
    .from("team_people")
    .select("id, name")
    .eq("tenant_slug", tenantSlug)
    .in("id", personIds);

  const peopleMap = new Map((people ?? []).map((p) => [p.id, p.name]));

  for (const h of handoffs) {
    const key = `${h.platform}:${h.thread_external_id}`;
    if (!distinctThreads.includes(key)) continue;

    const summary: HandoffSummary = {
      channel: h.channel,
      contact: h.contact,
      note: h.note,
      movedBy: {
        id: h.moved_by,
        name: peopleMap.get(h.moved_by) ?? "Team member",
      },
      movedAt: h.moved_at,
    };
    result.set(key, {
      handoff: summary,
      isStale: isHandoffStale(h.moved_at, resolvedStaleDays),
    });
  }

  return result;
}
