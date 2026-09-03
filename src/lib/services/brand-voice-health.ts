// Placeholder detector for brand voice — distinguishes "never configured"
// (already caught by setup-status.ts's existence-only `brand_voice` check)
// from "configured but never actually authored," which is Gruve's real
// state today: tone "Clear, professional, and engaging voice for Gruve",
// audience "Customers and audience interested in Gruve", example post
// "Welcome to Gruve! We're excited to share our latest updates with you".
// generateEngagementReplyDraft reads this config for every DM/comment
// reply it drafts — an unauthored config means every "on-brand" draft is
// actually placeholder voice wearing the tenant's name.

import { createAdminClient } from "@/lib/supabase/admin";
import { getBrandVoice, type BrandVoice } from "@/lib/ai/brand-voice";

export interface BrandVoiceHealth {
  unauthored: boolean;
  reasons: string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Five heuristics, ANDed with a >=2 threshold so one coincidental match
 * (e.g. a real tenant genuinely named their audience "customers") doesn't
 * false-positive alone.
 */
export function detectUnauthoredBrandVoice(voice: BrandVoice | null, tenantName: string): BrandVoiceHealth {
  if (!voice) return { unauthored: true, reasons: ["No brand voice configured"] };

  const reasons: string[] = [];
  const name = tenantName.trim();
  const namePattern = name ? escapeRegExp(name) : null;

  // 1. An empty or effectively-empty field (zod requires non-empty
  // strings, but whitespace-only / near-empty still slips through).
  const requiredStrings = [voice.tone, voice.audience, ...voice.example_posts];
  if (requiredStrings.some((f) => !f || f.trim().length < 3)) {
    reasons.push("A required field is empty or near-empty");
  }

  // 2. The tenant name substituted into an otherwise generic sentence —
  // the exact onboarding-default tone shape.
  if (namePattern && new RegExp(`professional,?\\s*and\\s*engaging\\s*voice\\s*for\\s*${namePattern}`, "i").test(voice.tone)) {
    reasons.push("Tone reads as a generic template with the tenant name substituted in");
  }

  // 3. A value that would be true of any business, regardless of name.
  if (/\b(customers?|audience|users?)\b.*\b(interested in|of)\b/i.test(voice.audience) && voice.audience.length < 80) {
    reasons.push("Audience description is generic boilerplate, not a real description of who they're for");
  }

  // 4. The "Welcome to {Name}!" example post, unedited.
  const welcomePattern = namePattern
    ? new RegExp(`welcome to ${namePattern}`, "i")
    : /welcome to \{?\s*name\s*\}?/i;
  if (voice.example_posts.some((p) => welcomePattern.test(p))) {
    reasons.push("Example post is the unedited 'Welcome to {Name}!' placeholder");
  }

  // 5. Audience stated verbatim as the onboarding default template.
  if (namePattern && new RegExp(`customers and audience interested in ${namePattern}`, "i").test(voice.audience)) {
    reasons.push("Audience matches the unedited onboarding default exactly");
  }

  return { unauthored: reasons.length >= 2, reasons };
}

export async function getBrandVoiceHealth(tenantSlug: string): Promise<BrandVoiceHealth> {
  const admin = createAdminClient();
  const [voice, tenantRow] = await Promise.all([
    getBrandVoice(tenantSlug),
    admin.from("tenants").select("name").eq("slug", tenantSlug).maybeSingle(),
  ]);
  return detectUnauthoredBrandVoice(voice, (tenantRow.data?.name as string | undefined) ?? "");
}
