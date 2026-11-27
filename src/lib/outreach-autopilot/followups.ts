// Drafts follow-ups for emails that got no reply. Drafts only: every
// follow-up goes through the same approval email as a first message.
//
//   cold_open sent N1 days ago, no reply  -> follow_up_1 draft (same thread)
//   follow_up_1 sent (N2-N1) days ago     -> follow_up_2 draft (same thread)
//
// A unique index on (parent_dm_id, kind) means a retry can't draft twice.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MailboxConfig } from "./mailbox";
import { addDays } from "./schedule";
import { renderFollowUp, replySubject } from "./templates";
import { buildGreeting } from "@/lib/services/outreach-composition";

const STOP_STATUSES = new Set(["replied", "handed_off", "closed_won", "closed_lost", "dismissed", "unqualified"]);

export interface FollowUpCopy {
  followUp1Body: string;
  followUp2Body: string;
  signature: string;
}

interface Step {
  fromKind: "cold_open" | "follow_up_1";
  toKind: "follow_up_1" | "follow_up_2";
  waitDays: number;
  template: string;
}

export async function draftDueFollowUps(
  admin: SupabaseClient,
  mailbox: MailboxConfig,
  copy: FollowUpCopy,
  now: Date = new Date()
): Promise<{ drafted: number }> {
  if (!mailbox.autoFollowUps) return { drafted: 0 };
  const tenantSlug = mailbox.tenantSlug;

  const steps: Step[] = [
    { fromKind: "cold_open", toKind: "follow_up_1", waitDays: mailbox.followUp1Days, template: copy.followUp1Body },
    {
      fromKind: "follow_up_1",
      toKind: "follow_up_2",
      waitDays: mailbox.followUp2Days - mailbox.followUp1Days,
      template: copy.followUp2Body,
    },
  ];

  let drafted = 0;
  for (const step of steps) {
    const cutoff = addDays(now, -step.waitDays).toISOString();
    const { data: parents } = await admin
      .from("outbound_dms")
      .select("id, prospect_id, subject, to_email")
      .eq("tenant_slug", tenantSlug)
      .eq("kind", step.fromKind)
      .eq("status", "sent")
      .eq("send_via", "mailbox")
      .lte("sent_at", cutoff)
      .order("sent_at", { ascending: true })
      .limit(100);
    if (!parents?.length) continue;

    for (const parent of parents) {
      const { data: existing } = await admin
        .from("outbound_dms")
        .select("id")
        .eq("tenant_slug", tenantSlug)
        .eq("parent_dm_id", parent.id)
        .eq("kind", step.toKind)
        .maybeSingle();
      if (existing) continue;

      const { data: p } = await admin
        .from("prospects")
        .select("id, status, channel_handoff, email_status, verified_name, display_name, company_name, handle")
        .eq("tenant_slug", tenantSlug)
        .eq("id", parent.prospect_id)
        .maybeSingle();
      if (!p) continue;
      if (STOP_STATUSES.has(p.status as string)) continue;
      if (p.channel_handoff && p.channel_handoff !== "none") continue;
      if (p.email_status === "dropped") continue;

      // Any reply on record since the first email stops the sequence, even if
      // the prospect's status was moved back by hand.
      const { count: replies } = await admin
        .from("inbound_messages")
        .select("id", { count: "exact", head: true })
        .eq("tenant_slug", tenantSlug)
        .eq("prospect_id", p.id);
      if ((replies ?? 0) > 0) continue;

      const person = ((p.verified_name as string) || "").trim();
      const company = ((p.company_name as string) || (p.display_name as string) || (p.handle as string) || "").trim();
      const body = renderFollowUp(step.template, {
        greeting: buildGreeting(person, company),
        company,
        signature: copy.signature,
        firstName: person.split(/\s+/)[0] || null,
      });

      const { data: latest } = await admin
        .from("outbound_dms")
        .select("version")
        .eq("tenant_slug", tenantSlug)
        .eq("prospect_id", p.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { error } = await admin.from("outbound_dms").insert({
        tenant_slug: tenantSlug,
        prospect_id: p.id,
        version: ((latest?.version as number) ?? 0) + 1,
        kind: step.toKind,
        parent_dm_id: parent.id,
        subject: replySubject(parent.subject as string | null),
        to_email: parent.to_email,
        body,
        status: "drafted",
        generator_model: "autopilot-follow-up",
        generator_cost_usd: 0,
      });
      if (!error) drafted++;
    }
  }
  return { drafted };
}
