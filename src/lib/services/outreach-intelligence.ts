import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProspectRecord } from "@/lib/types/outbound";
import type {
  ConversationAnalysisRecord,
  ProspectNoteRecord,
  ThreadEvent,
} from "@/lib/types/outreach-intelligence";
import type { ThreadMessage } from "@/lib/ai/conversation-intelligence";

// ── Row mappers ──────────────────────────────────────────────────────────────

function analysisRowTo(row: Record<string, unknown>): ConversationAnalysisRecord {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    prospectId: row.prospect_id as string,
    triggerType: row.trigger_type as ConversationAnalysisRecord["triggerType"],
    triggerId: (row.trigger_id as string | null) ?? null,
    conversationStage: row.conversation_stage as ConversationAnalysisRecord["conversationStage"],
    intentSummary: row.intent_summary as string,
    recommendedFollowUpAt: (row.recommended_follow_up_at as string | null) ?? null,
    recommendedFollowUpNote: (row.recommended_follow_up_note as string | null) ?? null,
    recommendedWaitDays: (row.recommended_wait_days as number | null) ?? null,
    objectionDetected: row.objection_detected as boolean,
    objectionCategory: (row.objection_category as ConversationAnalysisRecord["objectionCategory"]) ?? null,
    riskLevel: row.risk_level as ConversationAnalysisRecord["riskLevel"],
    gruveRelevant: row.gruve_relevant as boolean,
    sippoyRelevant: row.sippoy_relevant as boolean,
    model: (row.model as string | null) ?? null,
    costUsd: row.cost_usd as number,
    createdAt: row.created_at as string,
  };
}

function noteRowTo(row: Record<string, unknown>): ProspectNoteRecord {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    prospectId: row.prospect_id as string,
    body: row.body as string,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function prospectRowTo(row: Record<string, unknown>): ProspectRecord {
  return {
    id: row.id as string,
    tenantSlug: row.tenant_slug as string,
    searchId: (row.search_id as string | null) ?? null,
    platform: row.platform as ProspectRecord["platform"],
    handle: row.handle as string,
    displayName: (row.display_name as string | null) ?? null,
    profileUrl: (row.profile_url as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    followerCount: (row.follower_count as number | null) ?? null,
    signalSummary: (row.signal_summary as string | null) ?? null,
    signalData: (row.signal_data as Record<string, unknown>) ?? {},
    qualificationScore: (row.qualification_score as number | null) ?? null,
    qualificationReason: (row.qualification_reason as string | null) ?? null,
    status: row.status as ProspectRecord["status"],
    notes: (row.notes as string | null) ?? null,
    category: (row.category as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    verifiedName: (row.verified_name as string | null) ?? null,
    eventTitle: (row.event_title as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    lastReachoutAt: (row.last_reachout_at as string | null) ?? null,
    lastTouchedAt: (row.last_touched_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ── Latest analysis per prospect ─────────────────────────────────────────────

export async function getLatestAnalysis(
  client: SupabaseClient,
  prospectId: string
): Promise<ConversationAnalysisRecord | null> {
  const { data } = await client
    .from("conversation_analyses")
    .select("*")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return analysisRowTo(data as Record<string, unknown>);
}

// ── Full conversation thread for a prospect ──────────────────────────────────

export async function getConversationThread(
  client: SupabaseClient,
  tenantSlug: string,
  prospectId: string
): Promise<ThreadEvent[]> {
  const [dmsRes, inboundRes, notesRes, analysesRes] = await Promise.all([
    client
      .from("outbound_dms")
      .select("id, body, status, version, created_at")
      .eq("tenant_slug", tenantSlug)
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: true }),
    client
      .from("inbound_messages")
      .select("id, body, received_at")
      .eq("tenant_slug", tenantSlug)
      .eq("prospect_id", prospectId)
      .order("received_at", { ascending: true }),
    client
      .from("prospect_notes")
      .select("id, body, created_at")
      .eq("tenant_slug", tenantSlug)
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: true }),
    client
      .from("conversation_analyses")
      .select("*")
      .eq("tenant_slug", tenantSlug)
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: true })
      .limit(20),
  ]);

  const events: ThreadEvent[] = [];

  for (const dm of dmsRes.data ?? []) {
    events.push({
      id: dm.id as string,
      type: "outbound_dm",
      createdAt: dm.created_at as string,
      dmBody: dm.body as string,
      dmStatus: dm.status as string,
      dmVersion: dm.version as number,
    });
  }

  for (const msg of inboundRes.data ?? []) {
    events.push({
      id: msg.id as string,
      type: "inbound_message",
      createdAt: msg.received_at as string,
      messageBody: msg.body as string,
    });
  }

  for (const note of notesRes.data ?? []) {
    events.push({
      id: note.id as string,
      type: "note",
      createdAt: note.created_at as string,
      noteBody: note.body as string,
    });
  }

  for (const analysis of analysesRes.data ?? []) {
    events.push({
      id: analysis.id as string,
      type: "analysis",
      createdAt: analysis.created_at as string,
      analysis: analysisRowTo(analysis as Record<string, unknown>),
    });
  }

  events.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  return events;
}

// ── Daily command center ─────────────────────────────────────────────────────

export interface ProspectWithFollowUp extends ProspectRecord {
  followUpAt: string | null;
  followUpNote: string | null;
  latestAnalysis: ConversationAnalysisRecord | null;
}

export interface OutreachTodayData {
  overdue: ProspectWithFollowUp[];
  dueToday: ProspectWithFollowUp[];
  newReplies: Array<{
    id: string;
    prospectId: string;
    body: string;
    receivedAt: string;
    prospect: ProspectRecord | null;
  }>;
  goingCold: ProspectWithFollowUp[];
}

const COLD_DAYS = 7;

export async function getOutreachToday(
  client: SupabaseClient,
  tenantSlug: string
): Promise<OutreachTodayData> {
  const supabase = client;
  const now = new Date();
  const todayStart = now.toISOString().slice(0, 10);
  const todayEnd = new Date(now);
  todayEnd.setHours(23, 59, 59, 999);
  const coldCutoff = new Date(now);
  coldCutoff.setDate(coldCutoff.getDate() - COLD_DAYS);

  const [overdueRes, dueTodayRes, newRepliesRes, coldRes] = await Promise.all([
    // Overdue: follow_up_at before today midnight
    supabase
      .from("prospects")
      .select("*")
      .eq("tenant_slug", tenantSlug)
      .not("follow_up_at", "is", null)
      .lt("follow_up_at", todayStart)
      .not("status", "in", "(closed_won,closed_lost,dismissed,unqualified)")
      .order("follow_up_at", { ascending: true })
      .limit(30),

    // Due today: follow_up_at between today start and today end
    supabase
      .from("prospects")
      .select("*")
      .eq("tenant_slug", tenantSlug)
      .not("follow_up_at", "is", null)
      .gte("follow_up_at", todayStart)
      .lte("follow_up_at", todayEnd.toISOString())
      .not("status", "in", "(closed_won,closed_lost,dismissed,unqualified)")
      .order("follow_up_at", { ascending: true })
      .limit(30),

    // New replies: unread inbound messages in last 48h — use direct tenant_slug filter
    supabase
      .from("inbound_messages")
      .select("id, prospect_id, body, received_at")
      .eq("tenant_slug", tenantSlug)
      .is("read_at", null)
      .gte(
        "received_at",
        new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()
      )
      .order("received_at", { ascending: false })
      .limit(20),

    // Going cold: sent but no reply after COLD_DAYS with no follow-up scheduled
    supabase
      .from("prospects")
      .select("*")
      .eq("tenant_slug", tenantSlug)
      .eq("status", "sent")
      .lt("last_touched_at", coldCutoff.toISOString())
      .is("follow_up_at", null)
      .order("last_touched_at", { ascending: true })
      .limit(20),
  ]);

  // Fetch latest analyses for overdue + dueToday + cold prospects
  const allProspectRows = [
    ...(overdueRes.data ?? []),
    ...(dueTodayRes.data ?? []),
    ...(coldRes.data ?? []),
  ];
  const prospectIds = [...new Set(allProspectRows.map((r) => r.id as string))];

  const analysesMap = new Map<string, ConversationAnalysisRecord>();
  if (prospectIds.length > 0) {
    const { data: analysesData } = await supabase
      .from("conversation_analyses")
      .select("*")
      .in("prospect_id", prospectIds)
      .order("created_at", { ascending: false });

    for (const row of analysesData ?? []) {
      const pid = row.prospect_id as string;
      if (!analysesMap.has(pid)) {
        analysesMap.set(pid, analysisRowTo(row as Record<string, unknown>));
      }
    }
  }

  function toWithFollowUp(row: Record<string, unknown>): ProspectWithFollowUp {
    return {
      ...prospectRowTo(row),
      followUpAt: (row.follow_up_at as string | null) ?? null,
      followUpNote: (row.follow_up_note as string | null) ?? null,
      latestAnalysis: analysesMap.get(row.id as string) ?? null,
    };
  }

  // Resolve prospect records for new replies
  const replyProspectIds = [
    ...new Set(
      (newRepliesRes.data ?? [])
        .map((r) => r.prospect_id as string | null)
        .filter(Boolean) as string[]
    ),
  ];
  const replyProspectsMap = new Map<string, ProspectRecord>();
  if (replyProspectIds.length > 0) {
    const { data: rps } = await supabase
      .from("prospects")
      .select("*")
      .in("id", replyProspectIds);
    for (const rp of rps ?? []) {
      replyProspectsMap.set(rp.id as string, prospectRowTo(rp as Record<string, unknown>));
    }
  }

  return {
    overdue: (overdueRes.data ?? []).map((r) =>
      toWithFollowUp(r as Record<string, unknown>)
    ),
    dueToday: (dueTodayRes.data ?? []).map((r) =>
      toWithFollowUp(r as Record<string, unknown>)
    ),
    newReplies: (newRepliesRes.data ?? []).map((r) => ({
      id: r.id as string,
      prospectId: (r.prospect_id as string | null) ?? "",
      body: r.body as string,
      receivedAt: r.received_at as string,
      prospect: replyProspectsMap.get((r.prospect_id as string | null) ?? "") ?? null,
    })),
    goingCold: (coldRes.data ?? []).map((r) =>
      toWithFollowUp(r as Record<string, unknown>)
    ),
  };
}

// ── Notes ────────────────────────────────────────────────────────────────────

export async function listProspectNotes(
  prospectId: string
): Promise<ProspectNoteRecord[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("prospect_notes")
    .select("*")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => noteRowTo(r as Record<string, unknown>));
}

// ── Thread messages for AI input ─────────────────────────────────────────────

export async function getThreadMessages(
  prospectId: string
): Promise<ThreadMessage[]> {
  const supabase = await createClient();
  const [dmsRes, inboundRes] = await Promise.all([
    supabase
      .from("outbound_dms")
      .select("body, created_at, status")
      .eq("prospect_id", prospectId)
      .in("status", ["sent", "replied"])
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("inbound_messages")
      .select("body, received_at")
      .eq("prospect_id", prospectId)
      .order("received_at", { ascending: false })
      .limit(6),
  ]);

  const messages: ThreadMessage[] = [];
  for (const dm of dmsRes.data ?? []) {
    messages.push({
      direction: "outbound",
      body: dm.body as string,
      sentAt: dm.created_at as string,
    });
  }
  for (const msg of inboundRes.data ?? []) {
    messages.push({
      direction: "inbound",
      body: msg.body as string,
      sentAt: msg.received_at as string,
    });
  }

  // Newest first for AI prompt (capped at 12 inside the AI module)
  messages.sort(
    (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()
  );
  return messages;
}
