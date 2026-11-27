// The instant "someone replied" email, split by approver: each lead owner
// gets the replies from their own leads, the drafted answers and a link
// scoped to only those drafts. The workspace approver gets the rest, plus a
// line saying how many replies went to lead owners.
// Internal approval email only (Brevo). Nothing here emails a lead.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendBrevoEmail, getAppBaseUrl } from "@/lib/integrations/brevo";
import type { MailboxConfig } from "./mailbox";
import type { ReplyEvent } from "./replies";
import type { ReplyDraftOutcome } from "./reply-draft";
import { buildReplyAlertEmail, type ReplyAlertItem } from "./reply-copy";
import { createApprovalLink, isDigestConfigured } from "./digest";
import { groupByApprover, resolveApprovers, type AuthEmailLookup } from "./approvers";

export async function sendReplyAlerts(
  admin: SupabaseClient,
  config: MailboxConfig,
  tenantName: string,
  replies: ReplyEvent[],
  outcomes: ReplyDraftOutcome[],
  now: Date,
  lookupAuthEmail?: AuthEmailLookup
): Promise<{ emails: number; errors: string[] }> {
  const errors: string[] = [];
  if (!replies.length) return { emails: 0, errors };

  const byLead = new Map(outcomes.map((o) => [o.event.prospectId, o]));
  const dmIdsByLead = new Map<string, string[]>();
  for (const o of outcomes) {
    if (!o.dmId) continue;
    const list = dmIdsByLead.get(o.event.prospectId) ?? [];
    list.push(o.dmId);
    dmIdsByLead.set(o.event.prospectId, list);
  }

  const seen = new Set<string>();
  const items: Array<{ prospectId: string; item: ReplyAlertItem }> = replies
    .filter((r) => (seen.has(r.prospectId) ? false : (seen.add(r.prospectId), true)))
    .map((r) => {
      const o = byLead.get(r.prospectId);
      return {
        prospectId: r.prospectId,
        item: {
          from: r.from,
          company: o?.company ?? null,
          snippet: r.snippet,
          optOut: r.optOut,
          intent: o?.intent ?? null,
          draft: o?.draft ?? null,
        },
      };
    });

  const approvers = await resolveApprovers(
    admin,
    config.tenantSlug,
    items.map((i) => i.prospectId),
    config.approverEmail,
    lookupAuthEmail
  );
  const workspaceEmail = config.approverEmail.trim().toLowerCase();
  const groups = groupByApprover(items, (i) => i.prospectId, approvers, config.approverEmail);
  const routed = groups.filter((g) => g.approver.email !== workspaceEmail).reduce((n, g) => n + g.items.length, 0);
  if (routed > 0 && !groups.some((g) => g.approver.email === workspaceEmail)) {
    groups.push({ approver: { email: workspaceEmail, userId: null, isOwner: false }, items: [] });
  }

  const autopilotUrl = `${getAppBaseUrl()}/autopilot`;
  let emails = 0;
  for (const g of groups) {
    const isWorkspace = g.approver.email === workspaceEmail;
    const dmIds = g.items.flatMap((i) => dmIdsByLead.get(i.prospectId) ?? []);

    let approveUrl: string | null = null;
    if (dmIds.length && isDigestConfigured()) {
      const link = await createApprovalLink(
        admin,
        config.tenantSlug,
        g.approver.email,
        dmIds,
        now,
        g.approver.userId
      ).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
      if ("url" in link) approveUrl = link.url;
      else errors.push(`reply link: ${link.error}`);
    }

    const email = buildReplyAlertEmail({
      tenantName,
      items: g.items.map((i) => i.item),
      approveUrl,
      autopilotUrl,
      routedToOwners: isWorkspace ? routed : 0,
    });
    const sent = await sendBrevoEmail({
      to: { email: g.approver.email },
      subject: email.subject,
      htmlContent: email.html,
      textContent: email.text,
      tags: ["outreach-replies"],
    });
    if (sent.ok) emails++;
    else errors.push(`reply alert: ${sent.error ?? "send failed"}`);
  }
  return { emails, errors };
}
