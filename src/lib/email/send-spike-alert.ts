// Fire-and-forget — call this after saving a high-vsAverage intel card.
// Generates a brand-voice "your angle" post via AI and emails the tenant's owners.

import { generateText } from "ai";
import { createAdminClient } from "@/lib/supabase/admin";
import { getModel } from "@/lib/ai/gateway";
import { getBrandContext, buildPositioningBlock } from "@/lib/ai/brand-positioning";
import { brevo } from "@/lib/email/brevo";
import { spikeAlertHtml } from "@/lib/email/spike-alert-email";

export async function sendSpikeAlert(params: {
  tenantSlug: string;
  competitorName: string;
  platform: string;
  contentType: string;
  multiplier: number;
  summary: string;
}): Promise<void> {
  const { tenantSlug, competitorName, platform, contentType, multiplier, summary } = params;

  const admin = createAdminClient();

  // Get tenant name + owner emails
  const [{ data: tenant }, { data: memberships }] = await Promise.all([
    admin.from("tenants").select("name").eq("slug", tenantSlug).maybeSingle(),
    admin
      .from("memberships")
      .select("user_id")
      .eq("tenant_slug", tenantSlug)
      .eq("role", "owner"),
  ]);

  if (!tenant || !memberships?.length) return;

  const ownerEmails: string[] = [];
  for (const { user_id } of memberships) {
    const { data: authUser } = await admin.auth.admin.getUserById(user_id);
    const email = authUser?.user?.email;
    if (email) ownerEmails.push(email);
  }
  if (!ownerEmails.length) return;

  // Generate brand-voice "your angle" quickly with gpt-4o-mini
  const { voice, positioning } = await getBrandContext(tenantSlug);
  const positioningBlock = buildPositioningBlock(positioning);
  const voiceHint = voice?.tone ? `Tone: ${voice.tone}.` : "";

  let yourAngle = `Use a similar ${contentType} format to create original content for your audience.`;
  try {
    const { text } = await generateText({
      model: getModel("scoring"),
      prompt: `${positioningBlock}\n${voiceHint}\n\n${competitorName} posted a ${contentType} on ${platform} that got ${multiplier.toFixed(1)}x their average engagement. Summary: ${summary}\n\nIn 2-3 sentences, suggest a specific post idea for this brand that uses the same energy and format but is completely original — no mention of competitors. Be concrete: format, what to show/say, the hook.`,
    });
    yourAngle = text.trim();
  } catch {
    // Fall back to generic guidance — don't block the alert send
  }

  const composerUrl = `https://pulse.gruve.events/composer?angle=${encodeURIComponent(yourAngle.slice(0, 200))}`;

  const html = spikeAlertHtml({
    tenantName: tenant.name,
    competitorName,
    platform,
    contentType,
    multiplier,
    summary,
    yourAngle,
    composerUrl,
  });

  const subject = `⚡ ${competitorName} just hit ${multiplier.toFixed(1)}x — here's your angle`;

  for (const email of ownerEmails) {
    try {
      await brevo.transactionalEmails.sendTransacEmail({
        sender: {
          name: "Pulse",
          email: process.env.BREVO_FROM_EMAIL ?? "digest@pulse.gruve.events",
        },
        to: [{ email }],
        subject,
        htmlContent: html,
      });
    } catch {
      // Non-critical — don't throw; cron / action can proceed
    }
  }
}
