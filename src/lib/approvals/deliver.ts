// Delivers an approval link over the requested channel. Shared by
// POST /api/v1/briefings/send and the pulse_send_briefing MCP tool so
// delivery logic lives in exactly one place.

import { brevo } from "@/lib/email/brevo";
import { approvalRequestHtml } from "@/lib/email/approval-email";
import { getWhatsappAccount, sendWhatsappTemplate } from "@/lib/integrations/whatsapp";
import type { ApprovalDeliveryChannel, ApprovalTarget } from "@/lib/services/approvals";

function targetLabel(target: ApprovalTarget): string {
  return target.type === "scheduled_post"
    ? `${target.platform[0].toUpperCase()}${target.platform.slice(1)} post`
    : "Content brief";
}

function targetPreview(target: ApprovalTarget): string {
  const text = target.type === "scheduled_post" ? target.content : target.draftContent || target.title;
  return text.slice(0, 200);
}

export type DeliverResult = { ok: true } | { ok: false; error: string };

export async function deliverApprovalLink(
  channel: ApprovalDeliveryChannel,
  to: string,
  tenantSlug: string,
  target: ApprovalTarget,
  approveUrl: string
): Promise<DeliverResult> {
  if (channel === "email") return deliverEmail(to, target, approveUrl);
  return deliverWhatsapp(to, tenantSlug, approveUrl);
}

async function deliverEmail(
  to: string,
  target: ApprovalTarget,
  approveUrl: string
): Promise<DeliverResult> {
  try {
    await brevo.transactionalEmails.sendTransacEmail({
      sender: { name: "Pulse", email: process.env.BREVO_FROM_EMAIL ?? "digest@pulse.gruve.events" },
      to: [{ email: to }],
      subject: `Needs your approval — ${targetLabel(target)}`,
      htmlContent: approvalRequestHtml({
        targetLabel: targetLabel(target),
        preview: targetPreview(target),
        approveUrl,
      }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Email send failed" };
  }
}

// Requires a Meta-approved WhatsApp template (proactive messages outside
// the 24h customer-service window can't be free-form text). The template
// must exist in the tenant's WhatsApp Business account before this works —
// name it via WHATSAPP_APPROVAL_TEMPLATE_NAME, one placeholder body param
// (the link). Degrades to an explicit error, not a silent no-op, if either
// the template isn't configured or the tenant has no WhatsApp account.
async function deliverWhatsapp(
  to: string,
  tenantSlug: string,
  approveUrl: string
): Promise<DeliverResult> {
  const templateName = process.env.WHATSAPP_APPROVAL_TEMPLATE_NAME;
  if (!templateName) {
    return { ok: false, error: "WhatsApp approval delivery isn't configured (WHATSAPP_APPROVAL_TEMPLATE_NAME unset)" };
  }
  const account = await getWhatsappAccount(tenantSlug);
  if (!account) return { ok: false, error: "No WhatsApp account connected for this tenant" };

  const result = await sendWhatsappTemplate(account, to, templateName, "en", [approveUrl]);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}
