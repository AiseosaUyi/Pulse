// Read layer for the unified /conversations shared-inbox UI (Track A Phase 2).
// See src/lib/types/conversations.ts for the grouping model.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type {
  ConversationMessage,
  ConversationPlatform,
  ConversationSource,
  ConversationStatus,
  ConversationSummary,
  ConversationThread,
  SentBy,
} from "@/lib/types/conversations";

// ── Time bound (eng-review-corrected, status-aware) ─────────────────────────
// Never drop anything still needing attention regardless of age; only
// time-bound the resolved bucket, which is the one that grows unboundedly.
// NOTE: this repo's `status` CHECK only allows ('open','resolved') today —
// 'pending' is included in the IN-list per the plan's exact wording (future-
// proofing if a 'pending' state is ever added); it simply never matches now.
const RECENT_WINDOW_DAYS = 90;

function recentCutoffIso(): string {
  return new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function withStatusAwareBound<T extends { or: (filter: string) => T }>(
  query: T,
  cutoffIso: string
): T {
  return query.or(`status.in.(open,pending),received_at.gt.${cutoffIso}`);
}

// ── Participant-key functions ────────────────────────────────────────────
// Grouping is virtual (never stored) — computed the same way at read time
// (listConversations/getConversationThread) and write time (assign/resolve
// bulk updates in lib/actions/inbound-messages.ts).

export function engagementItemParticipantKey(row: {
  meta?: unknown;
  fromHandle?: string | null;
  fromName?: string | null;
}): string {
  const meta = (row.meta ?? null) as { sender_id?: string } | null;
  const raw = meta?.sender_id || row.fromHandle || row.fromName || "";
  return raw.trim().toLowerCase();
}

export function inboundMessageParticipantKey(row: {
  fromHandle?: string | null;
  prospectId?: string | null;
  id: string;
}): string {
  const raw =
    row.fromHandle || (row.prospectId ? `prospect:${row.prospectId}` : `msg:${row.id}`);
  return raw.trim().toLowerCase();
}

// Which table a platform's conversations live in. WhatsApp only ever lives
// in inbound_messages (decision in the plan); every other platform lives in
// engagement_items. Non-whatsapp rows that also happen to land in
// inbound_messages (the separate Outbound/prospect-reply pipeline) are
// deliberately not surfaced in this inbox — different feature, same table.
export function sourceForPlatform(platform: string): ConversationSource {
  return platform === "whatsapp" ? "whatsapp" : "engagement";
}

export function buildConversationId(platform: string, participantKey: string): string {
  return `${platform}::${participantKey}`;
}

export function parseConversationId(
  id: string
): { platform: ConversationPlatform; participantKey: string } | null {
  const idx = id.indexOf("::");
  if (idx === -1) return null;
  const platform = id.slice(0, idx) as ConversationPlatform;
  const participantKey = id.slice(idx + 2);
  if (!platform || !participantKey) return null;
  return { platform, participantKey };
}

// ── Reply derivation ─────────────────────────────────────────────────────
// AI-vs-human signal: `approved_by IS NULL` on a sent reply means it was
// AI-authored (Phase 3 auto-send); otherwise a human sent/approved it.
export function deriveReply(row: {
  sentBody: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  receivedAt: string;
}): { body: string; sentBy: SentBy; at: string } | null {
  if (!row.sentBody) return null;
  return {
    body: row.sentBody,
    sentBy: row.approvedBy ? "human" : "ai_auto",
    at: row.approvedAt ?? row.receivedAt,
  };
}

// ── Row shapes (snake_case, as selected from Supabase) ───────────────────

interface EngagementRow {
  id: string;
  platform: string;
  from_name: string;
  from_handle: string | null;
  from_avatar: string | null;
  content: string;
  received_at: string;
  read: boolean;
  meta: unknown;
  assigned_to: string | null;
  status: string;
  sent_body: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

interface InboundRow {
  id: string;
  platform: string;
  from_handle: string | null;
  prospect_id: string | null;
  body: string;
  received_at: string;
  read_at: string | null;
  assigned_to: string | null;
  status: string;
  sent_body: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

const ENGAGEMENT_SELECT =
  "id, platform, from_name, from_handle, from_avatar, content, received_at, read, meta, assigned_to, status, sent_body, approved_by, approved_at";
const INBOUND_SELECT =
  "id, platform, from_handle, prospect_id, body, received_at, read_at, assigned_to, status, sent_body, approved_by, approved_at";

async function fetchEngagementRows(
  client: SupabaseClient,
  tenantSlug: string
): Promise<EngagementRow[]> {
  const cutoff = recentCutoffIso();
  let query = client.from("engagement_items").select(ENGAGEMENT_SELECT).eq("tenant_slug", tenantSlug);
  query = withStatusAwareBound(query, cutoff);
  const { data } = await query;
  return (data ?? []) as EngagementRow[];
}

async function fetchWhatsappRows(
  client: SupabaseClient,
  tenantSlug: string
): Promise<InboundRow[]> {
  const cutoff = recentCutoffIso();
  let query = client
    .from("inbound_messages")
    .select(INBOUND_SELECT)
    .eq("tenant_slug", tenantSlug)
    .eq("platform", "whatsapp");
  query = withStatusAwareBound(query, cutoff);
  const { data } = await query;
  return (data ?? []) as InboundRow[];
}

// ── Grouping accumulator ─────────────────────────────────────────────────

interface Accum {
  platform: string;
  participantKey: string;
  fromName: string;
  fromHandle: string | null;
  fromAvatar: string | null;
  newestRowAt: string; // tie-break for status/assignedTo/fromName (row-level attrs)
  status: ConversationStatus;
  assignedTo: string | null;
  lastMessageAt: string;
  lastMessageBody: string;
  latestRowId: string;
  unreadCount: number;
  messageCount: number;
  lastAiSentAt: string | null;
  lastAiSentBody: string | null;
}

function newAccum(platform: string, participantKey: string): Accum {
  return {
    platform,
    participantKey,
    fromName: participantKey,
    fromHandle: null,
    fromAvatar: null,
    newestRowAt: "",
    status: "open",
    assignedTo: null,
    lastMessageAt: "",
    lastMessageBody: "",
    latestRowId: "",
    unreadCount: 0,
    messageCount: 0,
    lastAiSentAt: null,
    lastAiSentBody: null,
  };
}

function applyRow(
  acc: Accum,
  row: {
    rowId: string;
    fromName: string;
    fromHandle: string | null;
    fromAvatar: string | null;
    receivedAt: string;
    inboundBody: string;
    unread: boolean;
    status: string;
    assignedTo: string | null;
    reply: { body: string; sentBy: SentBy; at: string } | null;
  }
) {
  acc.messageCount += 1;
  if (row.unread) acc.unreadCount += 1;

  // Row-level attributes (name/status/assignee) come from whichever row is
  // newest — a fresh inbound message naturally "reopens"/unassigns a
  // conversation until a human re-triages, which is the right passive
  // behavior here (assign/resolve bulk-updates every row in the group, so
  // this only diverges when a brand-new message just arrived).
  if (row.receivedAt > acc.newestRowAt) {
    acc.newestRowAt = row.receivedAt;
    acc.fromName = row.fromName;
    acc.fromHandle = row.fromHandle;
    acc.fromAvatar = row.fromAvatar;
    acc.status = (row.status as ConversationStatus) ?? "open";
    acc.assignedTo = row.assignedTo;
  }

  // Last message shown in the list = the most recent of (inbound, reply).
  if (row.receivedAt > acc.lastMessageAt) {
    acc.lastMessageAt = row.receivedAt;
    acc.lastMessageBody = row.inboundBody;
    acc.latestRowId = row.rowId;
  }
  if (row.reply) {
    if (row.reply.at > acc.lastMessageAt) {
      acc.lastMessageAt = row.reply.at;
      acc.lastMessageBody = row.reply.body;
      acc.latestRowId = row.rowId;
    }
    if (row.reply.sentBy === "ai_auto" && (!acc.lastAiSentAt || row.reply.at > acc.lastAiSentAt)) {
      acc.lastAiSentAt = row.reply.at;
      acc.lastAiSentBody = row.reply.body;
    }
  }
}

function toSummary(acc: Accum): ConversationSummary {
  return {
    id: buildConversationId(acc.platform, acc.participantKey),
    source: sourceForPlatform(acc.platform),
    platform: acc.platform as ConversationPlatform,
    participantKey: acc.participantKey,
    fromName: acc.fromName,
    fromHandle: acc.fromHandle,
    fromAvatar: acc.fromAvatar,
    lastMessageBody: acc.lastMessageBody,
    lastMessageAt: acc.lastMessageAt,
    unreadCount: acc.unreadCount,
    messageCount: acc.messageCount,
    status: acc.status,
    assignedTo: acc.assignedTo,
    lastAiSentAt: acc.lastAiSentAt,
    lastAiSentBody: acc.lastAiSentBody,
    latestRowId: acc.latestRowId,
  };
}

// ── Public reads ──────────────────────────────────────────────────────────

export async function listConversations(tenantSlug: string): Promise<ConversationSummary[]> {
  const supabase = await createClient();
  const [engRows, waRows] = await Promise.all([
    fetchEngagementRows(supabase, tenantSlug),
    fetchWhatsappRows(supabase, tenantSlug),
  ]);

  const groups = new Map<string, Accum>();

  for (const row of engRows) {
    const key = engagementItemParticipantKey({
      meta: row.meta,
      fromHandle: row.from_handle,
      fromName: row.from_name,
    });
    if (!key) continue;
    const groupKey = `${row.platform}::${key}`;
    const acc = groups.get(groupKey) ?? newAccum(row.platform, key);
    applyRow(acc, {
      rowId: row.id,
      fromName: row.from_name,
      fromHandle: row.from_handle,
      fromAvatar: row.from_avatar,
      receivedAt: row.received_at,
      inboundBody: row.content,
      unread: !row.read,
      status: row.status,
      assignedTo: row.assigned_to,
      reply: deriveReply({
        sentBody: row.sent_body,
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
        receivedAt: row.received_at,
      }),
    });
    groups.set(groupKey, acc);
  }

  for (const row of waRows) {
    const key = inboundMessageParticipantKey({
      fromHandle: row.from_handle,
      prospectId: row.prospect_id,
      id: row.id,
    });
    const groupKey = `${row.platform}::${key}`;
    const acc = groups.get(groupKey) ?? newAccum(row.platform, key);
    applyRow(acc, {
      rowId: row.id,
      fromName: row.from_handle ?? "WhatsApp contact",
      fromHandle: row.from_handle,
      fromAvatar: null,
      receivedAt: row.received_at,
      inboundBody: row.body,
      unread: row.read_at == null,
      status: row.status,
      assignedTo: row.assigned_to,
      reply: deriveReply({
        sentBody: row.sent_body,
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
        receivedAt: row.received_at,
      }),
    });
    groups.set(groupKey, acc);
  }

  return Array.from(groups.values())
    .map(toSummary)
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

export async function getConversationThread(
  tenantSlug: string,
  conversationId: string
): Promise<ConversationThread | null> {
  const parsed = parseConversationId(conversationId);
  if (!parsed) return null;
  const { platform, participantKey } = parsed;

  const supabase = await createClient();
  const messages: ConversationMessage[] = [];
  const acc = newAccum(platform, participantKey);
  let matched = false;
  const unreadEngagementIds: string[] = [];
  const unreadWhatsappIds: string[] = [];

  if (sourceForPlatform(platform) === "engagement") {
    const rows = await fetchEngagementRows(supabase, tenantSlug);
    for (const row of rows) {
      if (row.platform !== platform) continue;
      const key = engagementItemParticipantKey({
        meta: row.meta,
        fromHandle: row.from_handle,
        fromName: row.from_name,
      });
      if (key !== participantKey) continue;
      matched = true;
      const reply = deriveReply({
        sentBody: row.sent_body,
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
        receivedAt: row.received_at,
      });
      applyRow(acc, {
        rowId: row.id,
        fromName: row.from_name,
        fromHandle: row.from_handle,
        fromAvatar: row.from_avatar,
        receivedAt: row.received_at,
        inboundBody: row.content,
        unread: !row.read,
        status: row.status,
        assignedTo: row.assigned_to,
        reply,
      });
      messages.push({
        id: `${row.id}:in`,
        rowId: row.id,
        direction: "inbound",
        body: row.content,
        sentBy: null,
        read: row.read,
        createdAt: row.received_at,
      });
      if (!row.read) unreadEngagementIds.push(row.id);
      if (reply) {
        messages.push({
          id: `${row.id}:out`,
          rowId: row.id,
          direction: "outbound",
          body: reply.body,
          sentBy: reply.sentBy,
          read: true,
          createdAt: reply.at,
        });
      }
    }
  } else {
    const rows = await fetchWhatsappRows(supabase, tenantSlug);
    for (const row of rows) {
      const key = inboundMessageParticipantKey({
        fromHandle: row.from_handle,
        prospectId: row.prospect_id,
        id: row.id,
      });
      if (key !== participantKey) continue;
      matched = true;
      const reply = deriveReply({
        sentBody: row.sent_body,
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
        receivedAt: row.received_at,
      });
      applyRow(acc, {
        rowId: row.id,
        fromName: row.from_handle ?? "WhatsApp contact",
        fromHandle: row.from_handle,
        fromAvatar: null,
        receivedAt: row.received_at,
        inboundBody: row.body,
        unread: row.read_at == null,
        status: row.status,
        assignedTo: row.assigned_to,
        reply,
      });
      messages.push({
        id: `${row.id}:in`,
        rowId: row.id,
        direction: "inbound",
        body: row.body,
        sentBy: null,
        read: row.read_at != null,
        createdAt: row.received_at,
      });
      if (row.read_at == null) unreadWhatsappIds.push(row.id);
      if (reply) {
        messages.push({
          id: `${row.id}:out`,
          rowId: row.id,
          direction: "outbound",
          body: reply.body,
          sentBy: reply.sentBy,
          read: true,
          createdAt: reply.at,
        });
      }
    }
  }

  if (!matched) return null;

  messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Opening a thread marks its unread rows read — best-effort, same session
  // client (RLS-scoped), fire-and-forget so a failure here never blocks the
  // thread from rendering.
  if (unreadEngagementIds.length) {
    void supabase
      .from("engagement_items")
      .update({ read: true })
      .in("id", unreadEngagementIds);
  }
  if (unreadWhatsappIds.length) {
    void supabase
      .from("inbound_messages")
      .update({ read_at: new Date().toISOString() })
      .in("id", unreadWhatsappIds);
  }

  const conversation = toSummary(acc);
  return { conversation, messages };
}
