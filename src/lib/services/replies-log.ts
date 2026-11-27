import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ProspectReplyEntry,
  RecordReplyInput,
  MissingCapabilityInsight,
} from "@/lib/types/replies";
import { recordContactedFromProspect } from "@/lib/services/outreach-ledger";
import { ownedProspectId } from "@/lib/services/prospect-scope";

export async function recordProspectReply(
  client: SupabaseClient,
  workspace: string,
  input: RecordReplyInput
): Promise<{ success: boolean; reply: ProspectReplyEntry; sent: false }> {
  const repliedAt = input.repliedAt || new Date().toISOString();
  const prospectId = await ownedProspectId(client, workspace, input.prospectId);
  if (input.prospectId && !prospectId) {
    throw new Error("Prospect not found");
  }

  const { data, error } = await client
    .from("prospect_replies")
    .insert({
      workspace,
      prospect_id: prospectId,
      replied_at: repliedAt,
      channel: input.channel,
      quote: input.quote,
      status: input.status,
      next_step: input.nextStep ?? null,
      missing_capability: input.missingCapability ?? null,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to insert reply record");
  }

  // If linked to a prospect, update prospect stage & record in ledger
  if (input.prospectId) {
    const prospectStatus =
      input.status === "closed"
        ? "closed_won"
        : input.status === "declined"
        ? "closed_lost"
        : "replied";

    const { data: prospect } = await client
      .from("prospects")
      .update({
        status: prospectStatus,
        last_touched_at: repliedAt,
      })
      .eq("id", input.prospectId)
      .eq("tenant_slug", workspace)
      .select("*")
      .maybeSingle();

    if (prospect) {
      await recordContactedFromProspect(client, workspace, {
        handle: prospect.handle,
        email: prospect.email,
        phone: prospect.phone,
        website: prospect.website,
        companyName: prospect.company_name || prospect.display_name,
        runId: prospect.run_id,
      }, `Prospect replied via ${input.channel}: "${input.quote.slice(0, 60)}"`);
    }
  }

  return {
    success: true,
    reply: replyRowToEntry(data),
    sent: false,
  };
}

export async function listReplies(
  client: SupabaseClient,
  workspace: string,
  opts: { limit?: number; status?: string } = {}
): Promise<{ replies: ProspectReplyEntry[]; sent: false }> {
  let query = client
    .from("prospect_replies")
    .select("*")
    .eq("workspace", workspace)
    .order("replied_at", { ascending: false });

  if (opts.status) {
    query = query.eq("status", opts.status);
  }
  if (opts.limit) {
    query = query.limit(opts.limit);
  } else {
    query = query.limit(50);
  }

  const { data, error } = await query;
  if (error || !data) return { replies: [], sent: false };

  return {
    replies: data.map(replyRowToEntry),
    sent: false,
  };
}

export async function listWeeklyMissingCapabilities(
  client: SupabaseClient,
  workspace: string,
  sinceDays = 30
): Promise<{ insights: MissingCapabilityInsight[]; sent: false }> {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);

  const { data, error } = await client
    .from("prospect_replies")
    .select("*")
    .eq("workspace", workspace)
    .not("missing_capability", "is", null)
    .gte("replied_at", since.toISOString())
    .order("replied_at", { ascending: false });

  if (error || !data) return { insights: [], sent: false };

  const groups: Record<string, { count: number; latestQuote: string; latestDate: string; channels: Set<string> }> = {};

  for (const r of data) {
    const cap = (r.missing_capability as string).trim();
    if (!cap) continue;
    if (!groups[cap]) {
      groups[cap] = {
        count: 0,
        latestQuote: r.quote as string,
        latestDate: r.replied_at as string,
        channels: new Set(),
      };
    }
    groups[cap].count++;
    groups[cap].channels.add(r.channel as string);
  }

  const insights: MissingCapabilityInsight[] = Object.entries(groups)
    .map(([capability, g]) => ({
      capability,
      count: g.count,
      latestQuote: g.latestQuote,
      latestRepliedAt: g.latestDate,
      channels: Array.from(g.channels),
    }))
    .sort((a, b) => b.count - a.count);

  return { insights, sent: false };
}

function replyRowToEntry(row: Record<string, unknown>): ProspectReplyEntry {
  return {
    id: row.id as string,
    workspace: (row.workspace as string) ?? (row.tenant_slug as string),
    tenantSlug: (row.tenant_slug as string) ?? (row.workspace as string),
    prospectId: (row.prospect_id as string) || null,
    repliedAt: row.replied_at as string,
    channel: row.channel as string,
    quote: row.quote as string,
    status: row.status as ProspectReplyEntry["status"],
    nextStep: (row.next_step as string) || null,
    missingCapability: (row.missing_capability as string) || null,
    createdAt: row.created_at as string,
  };
}
