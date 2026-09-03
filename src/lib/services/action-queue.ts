// Action Queue — the unified board behind /dashboard, /api/v1/action-queue,
// and the pulse_action_queue MCP tool. Normalizes engagement_items (IG
// comments/DMs), action_items (non-message attention), coach_actions
// (mapped in virtually, never written here — see below), and prospects
// follow-ups (via getOutreachToday) into one QueueRow shape so callers never
// branch on source. Every mutation takes an explicit tenantSlug and scopes
// every query to it — never RLS-only, since MCP/API auth uses the admin
// client where auth.uid() is null (same trap markInboxReplied documents).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getOutreachToday, type ProspectWithFollowUp } from "@/lib/services/outreach-intelligence";

export type QueueSource = "engagement" | "action" | "coach" | "prospect";
export type QueueKind = "reply" | "follow_up" | "decision" | "escalation" | "opportunity" | "chore";
export type QueuePriority = "urgent" | "high" | "normal" | "low";
export type QueueStatus = "open" | "snoozed" | "resolved" | "dismissed";
export type QueueGroupKey =
  | "needs_reply"
  | "needs_decision"
  | "follow_ups_due"
  | "going_cold"
  | "opportunities"
  | "resolved";

export interface RowRef {
  source: QueueSource;
  id: string;
}

export interface QueueRow {
  id: string;
  source: QueueSource;
  kind: QueueKind;
  platform: string | null;
  channel: "comment" | "dm" | "mention" | "other" | null;
  title: string;
  body: string | null;
  why: string | null;
  fromName: string | null;
  fromHandle: string | null;
  externalUrl: string | null;
  actionLabel: string | null;
  proposedReply: string | null;
  proposedReplyAuthor: string | null;
  sentBody: string | null;
  priority: QueuePriority;
  status: QueueStatus;
  assignedTo: string | null;
  dueAt: string | null;
  snoozedUntil: string | null;
  receivedAt: string;
  resolvedAt: string | null;
}

export interface QueueGroup {
  key: QueueGroupKey;
  label: string;
  count: number;
  rows: QueueRow[];
}

export interface ListActionQueueFilter {
  status?: QueueStatus;
  kind?: QueueKind;
  priority?: QueuePriority;
  /** "me" resolves against currentUserId; "unassigned" means assignedTo is null. */
  assignedTo?: "me" | "unassigned" | string;
  currentUserId?: string;
  platform?: string;
  since?: string;
  limit?: number;
  offset?: number;
}

export interface ListActionQueueResult {
  groups: QueueGroup[];
  total: number;
}

const GROUP_LABELS: Record<
  "needs_reply" | "needs_decision" | "follow_ups_due" | "going_cold" | "opportunities",
  string
> = {
  needs_reply: "Needs a reply",
  needs_decision: "Needs a decision",
  follow_ups_due: "Follow-ups due",
  going_cold: "Going cold",
  opportunities: "Opportunities",
};

const PRIORITY_RANK: Record<QueuePriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

// Mirrors outreach-intelligence.ts's private COLD_DAYS — duplicated rather
// than imported since that module doesn't export it.
const COLD_DAYS = 7;

// ── Row mappers ──────────────────────────────────────────────────────────

function engagementChannel(type: string): QueueRow["channel"] {
  if (type === "dm") return "dm";
  if (type === "comment") return "comment";
  if (type === "mention") return "mention";
  return "other";
}

function engagementActionLabel(type: string): string {
  if (type === "dm") return "Open DM";
  if (type === "comment") return "Open comment";
  if (type === "mention") return "Open post";
  return "Open";
}

function engagementRowToQueueRow(row: Record<string, unknown>): QueueRow {
  const type = (row.type as string) ?? "comment";
  return {
    id: row.id as string,
    source: "engagement",
    kind: "reply",
    platform: (row.platform as string | null) ?? null,
    channel: engagementChannel(type),
    title: (row.content as string) ?? "",
    body: null,
    why: null,
    fromName: (row.from_name as string | null) ?? null,
    fromHandle: (row.from_handle as string | null) ?? null,
    externalUrl: (row.external_url as string | null) ?? null,
    actionLabel: engagementActionLabel(type),
    proposedReply: (row.proposed_reply as string | null) ?? null,
    proposedReplyAuthor: (row.proposed_reply_author as string | null) ?? null,
    sentBody: (row.sent_body as string | null) ?? null,
    priority: ((row.priority as QueuePriority) ?? "normal"),
    status: ((row.status as QueueStatus) ?? "open"),
    assignedTo: (row.assigned_to as string | null) ?? null,
    dueAt: (row.due_at as string | null) ?? null,
    snoozedUntil: (row.snoozed_until as string | null) ?? null,
    receivedAt: row.received_at as string,
    resolvedAt: (row.resolved_at as string | null) ?? null,
  };
}

function actionItemRowToQueueRow(row: Record<string, unknown>): QueueRow {
  return {
    id: row.id as string,
    source: "action",
    kind: row.kind as QueueKind,
    platform: (row.platform as string | null) ?? null,
    channel: "other",
    title: row.title as string,
    body: (row.body as string | null) ?? null,
    why: (row.why as string | null) ?? null,
    fromName: null,
    fromHandle: null,
    externalUrl: (row.external_url as string | null) ?? null,
    actionLabel: (row.action_label as string | null) ?? null,
    proposedReply: (row.proposed_reply as string | null) ?? null,
    proposedReplyAuthor: (row.proposed_reply_author as string | null) ?? null,
    sentBody: null,
    priority: ((row.priority as QueuePriority) ?? "normal"),
    status: ((row.status as QueueStatus) ?? "open"),
    assignedTo: (row.assigned_to as string | null) ?? null,
    dueAt: (row.due_at as string | null) ?? null,
    snoozedUntil: (row.snoozed_until as string | null) ?? null,
    receivedAt: row.created_at as string,
    resolvedAt: (row.resolved_at as string | null) ?? null,
  };
}

const COACH_STATUS_TO_QUEUE: Record<string, QueueStatus> = {
  pending: "open",
  in_progress: "open",
  snoozed: "snoozed",
  done: "resolved",
  dismissed: "dismissed",
};

// Coach actions don't carry an explicit "is this an opportunity or a
// chore" flag — this is a judgment call, not a stored fact: source types
// that represent something external worth capitalizing on map to
// "opportunity" (surfaced in the Opportunities group); everything else
// (self-referential fixes: score/gap/digest-driven suggestions) maps to
// "chore", folded into "Needs a decision" per the brief's own 5-group
// hierarchy (§0.7 of the plan — a 6th group wasn't wanted).
const COACH_OPPORTUNITY_SOURCE_TYPES = new Set(["intel_signal", "competitor_move", "ads_signal"]);

function coachRowToQueueRow(row: Record<string, unknown>): QueueRow {
  const sourceType = (row.source_type as string) ?? "generic";
  const priorityNum = (row.priority as number) ?? 2;
  return {
    id: row.id as string,
    source: "coach",
    kind: COACH_OPPORTUNITY_SOURCE_TYPES.has(sourceType) ? "opportunity" : "chore",
    platform: null,
    channel: "other",
    title: row.title as string,
    body: (row.description as string | null) ?? null,
    why: null,
    fromName: null,
    fromHandle: null,
    externalUrl: (row.action_href as string | null) ?? null,
    actionLabel: (row.cta_label as string | null) ?? "Start",
    proposedReply: null,
    proposedReplyAuthor: null,
    sentBody: null,
    priority: priorityNum === 1 ? "urgent" : priorityNum === 2 ? "high" : "normal",
    status: COACH_STATUS_TO_QUEUE[(row.status as string) ?? "pending"] ?? "open",
    assignedTo: null,
    dueAt: (row.due_at as string | null) ?? null,
    snoozedUntil: (row.snoozed_until as string | null) ?? null,
    receivedAt: row.created_at as string,
    resolvedAt: (row.completed_at as string | null) ?? null,
  };
}

function prospectToQueueRow(p: ProspectWithFollowUp): QueueRow {
  return {
    id: p.id,
    source: "prospect",
    kind: "follow_up",
    platform: p.platform,
    channel: "other",
    title: p.displayName ?? p.handle,
    body: p.latestAnalysis?.intentSummary ?? p.signalSummary ?? null,
    why: p.followUpNote ?? p.latestAnalysis?.recommendedFollowUpNote ?? null,
    fromName: p.displayName ?? p.handle,
    fromHandle: p.handle,
    externalUrl: p.profileUrl,
    actionLabel: "Open profile",
    proposedReply: null,
    proposedReplyAuthor: null,
    sentBody: null,
    priority: "normal",
    status: "open",
    assignedTo: null,
    dueAt: p.followUpAt,
    snoozedUntil: null,
    receivedAt: p.followUpAt ?? p.lastTouchedAt ?? p.createdAt,
    resolvedAt: null,
  };
}

// ── Filtering / sorting ─────────────────────────────────────────────────

function matchesCommonFilters(row: QueueRow, filter: ListActionQueueFilter): boolean {
  if (filter.kind && row.kind !== filter.kind) return false;
  if (filter.platform && row.platform !== filter.platform) return false;
  if (filter.priority && row.priority !== filter.priority) return false;
  if (filter.assignedTo === "me" && row.assignedTo !== filter.currentUserId) return false;
  if (filter.assignedTo === "unassigned" && row.assignedTo !== null) return false;
  if (
    filter.assignedTo &&
    filter.assignedTo !== "me" &&
    filter.assignedTo !== "unassigned" &&
    row.assignedTo !== filter.assignedTo
  )
    return false;
  if (filter.since && new Date(row.receivedAt).getTime() < new Date(filter.since).getTime()) return false;
  return true;
}

function sortRows(rows: QueueRow[], dateField: "receivedAt" | "dueAt" | "resolvedAt" = "receivedAt"): QueueRow[] {
  return [...rows].sort((a, b) => {
    const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pr !== 0) return pr;
    const av = a[dateField] ? new Date(a[dateField] as string).getTime() : Number.POSITIVE_INFINITY;
    const bv = b[dateField] ? new Date(b[dateField] as string).getTime() : Number.POSITIVE_INFINITY;
    return av - bv;
  });
}

// ── Read ──────────────────────────────────────────────────────────────────

async function listQueueHistory(
  client: SupabaseClient,
  tenantSlug: string,
  filter: ListActionQueueFilter
): Promise<ListActionQueueResult> {
  const status = filter.status as "resolved" | "dismissed";
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;

  const [engRes, actionRes] = await Promise.all([
    client
      .from("engagement_items")
      .select("*", { count: "exact" })
      .eq("tenant_slug", tenantSlug)
      .eq("status", status)
      .order("resolved_at", { ascending: false })
      .range(offset, offset + limit - 1),
    client
      .from("action_items")
      .select("*", { count: "exact" })
      .eq("tenant_slug", tenantSlug)
      .eq("status", status)
      .order("resolved_at", { ascending: false })
      .range(offset, offset + limit - 1),
  ]);

  const rows = sortRows(
    [
      ...(engRes.data ?? []).map(engagementRowToQueueRow),
      ...(actionRes.data ?? []).map(actionItemRowToQueueRow),
    ].filter((r) => matchesCommonFilters(r, filter)),
    "resolvedAt"
  );

  const total = (engRes.count ?? 0) + (actionRes.count ?? 0);
  return {
    groups: [
      {
        key: "resolved",
        label: status === "resolved" ? "Resolved" : "Dismissed",
        rows,
        count: rows.length,
      },
    ],
    total,
  };
}

export async function listActionQueue(
  client: SupabaseClient,
  tenantSlug: string,
  filter: ListActionQueueFilter = {}
): Promise<ListActionQueueResult> {
  if (filter.status === "resolved" || filter.status === "dismissed") {
    return listQueueHistory(client, tenantSlug, filter);
  }

  const nowIso = new Date().toISOString();
  const now = new Date();
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const coldCutoff = new Date(now);
  coldCutoff.setDate(coldCutoff.getDate() - COLD_DAYS);

  const [engRes, actionRes, coachRes, outreach] = await Promise.all([
    client
      .from("engagement_items")
      .select("*")
      .eq("tenant_slug", tenantSlug)
      .in("status", ["open", "snoozed"])
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
      .order("received_at", { ascending: true })
      .limit(200),
    client
      .from("action_items")
      .select("*")
      .eq("tenant_slug", tenantSlug)
      .in("status", ["open", "snoozed"])
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
      .order("created_at", { ascending: true })
      .limit(150),
    client
      .from("coach_actions")
      .select("*")
      .eq("tenant_slug", tenantSlug)
      .in("status", ["pending", "in_progress", "snoozed"])
      .or(`snoozed_until.is.null,snoozed_until.lte.${nowIso}`)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(50),
    getOutreachToday(client, tenantSlug),
  ]);

  const engagementRows = (engRes.data ?? []).map(engagementRowToQueueRow);
  const actionRows = (actionRes.data ?? []).map(actionItemRowToQueueRow);
  const coachRows = (coachRes.data ?? []).map(coachRowToQueueRow);

  const followUpActionRows = actionRows.filter((r) => r.kind === "follow_up");
  const dueFollowUpActionRows = followUpActionRows.filter(
    (r) => r.dueAt && new Date(r.dueAt).getTime() <= todayEnd.getTime()
  );
  const coldFollowUpActionRows = followUpActionRows.filter(
    (r) => !r.dueAt && new Date(r.receivedAt).getTime() < coldCutoff.getTime()
  );

  const needsReply = [...engagementRows, ...actionRows.filter((r) => r.kind === "reply")].filter((r) =>
    matchesCommonFilters(r, filter)
  );

  const needsDecision = [
    ...actionRows.filter((r) => r.kind === "decision" || r.kind === "escalation" || r.kind === "chore"),
    ...coachRows.filter((r) => r.kind === "chore"),
  ].filter((r) => matchesCommonFilters(r, filter));

  const followUpsDue = [
    ...outreach.overdue.map(prospectToQueueRow),
    ...outreach.dueToday.map(prospectToQueueRow),
    ...dueFollowUpActionRows,
  ].filter((r) => matchesCommonFilters(r, filter));

  const goingCold = [...outreach.goingCold.map(prospectToQueueRow), ...coldFollowUpActionRows].filter((r) =>
    matchesCommonFilters(r, filter)
  );

  const opportunities = [
    ...actionRows.filter((r) => r.kind === "opportunity"),
    ...coachRows.filter((r) => r.kind === "opportunity"),
  ].filter((r) => matchesCommonFilters(r, filter));

  const groups: QueueGroup[] = [
    { key: "needs_reply", label: GROUP_LABELS.needs_reply, rows: sortRows(needsReply), count: needsReply.length },
    {
      key: "needs_decision",
      label: GROUP_LABELS.needs_decision,
      rows: sortRows(needsDecision, "dueAt"),
      count: needsDecision.length,
    },
    {
      key: "follow_ups_due",
      label: GROUP_LABELS.follow_ups_due,
      rows: sortRows(followUpsDue, "dueAt"),
      count: followUpsDue.length,
    },
    { key: "going_cold", label: GROUP_LABELS.going_cold, rows: sortRows(goingCold), count: goingCold.length },
    {
      key: "opportunities",
      label: GROUP_LABELS.opportunities,
      rows: sortRows(opportunities),
      count: opportunities.length,
    },
  ];

  const total = groups.reduce((sum, g) => sum + g.count, 0);
  return { groups, total };
}

// ── Write ─────────────────────────────────────────────────────────────────

export async function upsertEngagementItem(
  client: SupabaseClient,
  tenantSlug: string,
  input: {
    platform: string;
    type: string;
    externalId: string;
    fromName: string;
    fromHandle?: string | null;
    content: string;
    postTitle?: string | null;
    externalUrl?: string | null;
    receivedAt: string;
    sentiment?: string | null;
    priority?: QueuePriority;
    meta?: Record<string, unknown>;
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await client
    .from("engagement_items")
    .upsert(
      {
        tenant_slug: tenantSlug,
        type: input.type,
        platform: input.platform,
        external_id: input.externalId,
        source: "agent",
        from_name: input.fromName,
        from_handle: input.fromHandle ?? null,
        content: input.content,
        post_title: input.postTitle ?? null,
        external_url: input.externalUrl ?? null,
        received_at: input.receivedAt,
        sentiment: input.sentiment ?? "neutral",
        priority: input.priority ?? "normal",
        meta: input.meta ?? {},
      },
      { onConflict: "tenant_slug,platform,external_id" }
    )
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Upsert failed" };
  return { ok: true, id: data.id as string };
}

export async function upsertActionItem(
  client: SupabaseClient,
  tenantSlug: string,
  input: {
    kind: QueueKind;
    title: string;
    body?: string | null;
    why?: string | null;
    priority?: QueuePriority;
    platform?: string | null;
    externalUrl?: string | null;
    actionLabel?: string | null;
    proposedReply?: string | null;
    proposedReplyAuthor?: "agent" | "human" | "ai_generated" | null;
    dedupeKey: string;
    prospectId?: string | null;
    engagementItemId?: string | null;
    dueAt?: string | null;
    source?: "agent" | "cron" | "human";
    sourceRunId?: string | null;
    meta?: Record<string, unknown>;
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await client
    .from("action_items")
    .upsert(
      {
        tenant_slug: tenantSlug,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        why: input.why ?? null,
        priority: input.priority ?? "normal",
        platform: input.platform ?? null,
        external_url: input.externalUrl ?? null,
        action_label: input.actionLabel ?? null,
        proposed_reply: input.proposedReply ?? null,
        proposed_reply_author: input.proposedReplyAuthor ?? null,
        dedupe_key: input.dedupeKey,
        prospect_id: input.prospectId ?? null,
        engagement_item_id: input.engagementItemId ?? null,
        due_at: input.dueAt ?? null,
        source: input.source ?? "agent",
        source_run_id: input.sourceRunId ?? null,
        meta: input.meta ?? {},
      },
      { onConflict: "tenant_slug,dedupe_key" }
    )
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Upsert failed" };
  return { ok: true, id: data.id as string };
}

type MutationResult = { ok: true } | { ok: false; status: 404 | 500; error?: string };

function unsupported(op: string): MutationResult {
  return { ok: false, status: 404, error: `${op} is not supported for this row's source` };
}

export async function setProposedReply(
  client: SupabaseClient,
  tenantSlug: string,
  rowRef: RowRef,
  input: { text: string; author: "agent" | "human" | "ai_generated" }
): Promise<MutationResult> {
  if (rowRef.source === "coach" || rowRef.source === "prospect") return unsupported("Proposed reply");
  const table = rowRef.source === "engagement" ? "engagement_items" : "action_items";
  const { data, error } = await client
    .from(table)
    .update({ proposed_reply: input.text, proposed_reply_author: input.author })
    .eq("tenant_slug", tenantSlug)
    .eq("id", rowRef.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404 };
  return { ok: true };
}

export async function setQueueStatus(
  client: SupabaseClient,
  tenantSlug: string,
  rowRef: RowRef,
  input: { status: QueueStatus; resolutionNote?: string; snoozedUntil?: string; resolvedBy?: string }
): Promise<MutationResult> {
  if (rowRef.source === "coach") {
    const coachStatus =
      input.status === "resolved"
        ? "done"
        : input.status === "open"
          ? "pending"
          : input.status; // "snoozed" | "dismissed" map 1:1
    const patch: Record<string, unknown> = { status: coachStatus };
    if (coachStatus === "done") patch.completed_at = new Date().toISOString();
    if (coachStatus === "snoozed" && input.snoozedUntil !== undefined) patch.snoozed_until = input.snoozedUntil;
    if (coachStatus !== "snoozed") patch.snoozed_until = null;
    const { data, error } = await client
      .from("coach_actions")
      .update(patch)
      .eq("tenant_slug", tenantSlug)
      .eq("id", rowRef.id)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: error.message };
    if (!data) return { ok: false, status: 404 };
    return { ok: true };
  }

  if (rowRef.source === "prospect") {
    // Prospects have no status/resolved_at concept of their own — a
    // follow-up row is "resolved" by clearing follow_up_at (the same field
    // that put it on the board), and "snoozed" by rescheduling it.
    const patch: Record<string, unknown> = {};
    if (input.status === "resolved" || input.status === "dismissed") {
      patch.follow_up_at = null;
      patch.last_touched_at = new Date().toISOString();
    } else if (input.status === "snoozed") {
      patch.follow_up_at = input.snoozedUntil ?? null;
    } else {
      return unsupported("Reopening");
    }
    const { data, error } = await client
      .from("prospects")
      .update(patch)
      .eq("tenant_slug", tenantSlug)
      .eq("id", rowRef.id)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: error.message };
    if (!data) return { ok: false, status: 404 };
    return { ok: true };
  }

  const table = rowRef.source === "engagement" ? "engagement_items" : "action_items";
  const patch: Record<string, unknown> = { status: input.status };
  if (input.status === "resolved") {
    patch.resolved_at = new Date().toISOString();
    if (input.resolvedBy) patch.resolved_by = input.resolvedBy;
    if (rowRef.source === "engagement") patch.replied = true;
  }
  if (input.status === "snoozed" && input.snoozedUntil) patch.snoozed_until = input.snoozedUntil;
  if (input.status !== "snoozed") patch.snoozed_until = null;
  if (table === "action_items" && input.resolutionNote !== undefined) patch.resolution_note = input.resolutionNote;

  const { data, error } = await client
    .from(table)
    .update(patch)
    .eq("tenant_slug", tenantSlug)
    .eq("id", rowRef.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404 };
  return { ok: true };
}

export async function assignQueueRow(
  client: SupabaseClient,
  tenantSlug: string,
  rowRef: RowRef,
  assignedTo: string | null
): Promise<MutationResult> {
  if (rowRef.source === "coach" || rowRef.source === "prospect") return unsupported("Assignment");
  const table = rowRef.source === "engagement" ? "engagement_items" : "action_items";
  const { data, error } = await client
    .from(table)
    .update({ assigned_to: assignedTo })
    .eq("tenant_slug", tenantSlug)
    .eq("id", rowRef.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404 };
  return { ok: true };
}

const COACH_PRIORITY_FROM_QUEUE: Record<QueuePriority, 1 | 2 | 3> = {
  urgent: 1,
  high: 2,
  normal: 3,
  low: 3,
};

export async function setPriority(
  client: SupabaseClient,
  tenantSlug: string,
  rowRef: RowRef,
  priority: QueuePriority
): Promise<MutationResult> {
  if (rowRef.source === "prospect") return unsupported("Priority");
  if (rowRef.source === "coach") {
    const { data, error } = await client
      .from("coach_actions")
      .update({ priority: COACH_PRIORITY_FROM_QUEUE[priority] })
      .eq("tenant_slug", tenantSlug)
      .eq("id", rowRef.id)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: error.message };
    if (!data) return { ok: false, status: 404 };
    return { ok: true };
  }
  const table = rowRef.source === "engagement" ? "engagement_items" : "action_items";
  const { data, error } = await client
    .from(table)
    .update({ priority })
    .eq("tenant_slug", tenantSlug)
    .eq("id", rowRef.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404 };
  return { ok: true };
}

export async function setDueAt(
  client: SupabaseClient,
  tenantSlug: string,
  rowRef: RowRef,
  dueAt: string | null
): Promise<MutationResult> {
  const table =
    rowRef.source === "engagement"
      ? "engagement_items"
      : rowRef.source === "action"
        ? "action_items"
        : rowRef.source === "coach"
          ? "coach_actions"
          : "prospects";
  const column = rowRef.source === "prospect" ? "follow_up_at" : "due_at";
  const { data, error } = await client
    .from(table)
    .update({ [column]: dueAt })
    .eq("tenant_slug", tenantSlug)
    .eq("id", rowRef.id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404 };
  return { ok: true };
}

export async function startAgentRun(
  client: SupabaseClient,
  tenantSlug: string,
  input: { agent: string; surface?: string }
): Promise<{ runId: string }> {
  const { data, error } = await client
    .from("agent_runs")
    .insert({ tenant_slug: tenantSlug, agent: input.agent, surface: input.surface ?? null })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to start run");
  return { runId: data.id as string };
}

export async function finishAgentRun(
  client: SupabaseClient,
  tenantSlug: string,
  runId: string,
  summary: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; status: 404 }> {
  const { data, error } = await client
    .from("agent_runs")
    .update({ finished_at: new Date().toISOString(), summary })
    .eq("tenant_slug", tenantSlug)
    .eq("id", runId)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, status: 404 };
  return { ok: true };
}
