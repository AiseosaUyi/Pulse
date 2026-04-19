// Brand Positioning — the rich context layer that sits alongside
// Brand Voice and feeds every AI call. Voice is about *how* we write;
// Positioning is about *who we are, what we stand for, and what we
// cover*. Both live in `tenants.settings` — voice at `brand_voice`,
// positioning at `brand_positioning`. Never replace each other.

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBrandVoice, type BrandVoice } from "@/lib/ai/brand-voice";

export const brandPositioningSchema = z.object({
  mission: z.string().min(1, "Mission is required").max(400),
  value_proposition: z.string().min(1, "Value proposition is required").max(400),
  target_demographics: z
    .array(
      z.object({
        segment: z.string().min(1, "Segment name is required"),
        pain_points: z
          .array(z.string().min(1))
          .min(1, "At least one pain point per segment"),
      })
    )
    .min(1, "At least one target demographic"),
  // OpenAI strict structured-output requires every property in the
  // `required` array. `.default([])` and `.optional()` both produce
  // non-required fields, which trip the "Missing '<field>'" error.
  // Arrays that can be empty must be present-but-empty, not absent.
  topics_to_cover: z.array(z.string().min(1)).max(30),
  topics_to_avoid: z.array(z.string().min(1)).max(30),
  competitors: z.array(
    z.object({
      name: z.string().min(1),
      domain: z.string().nullable(),
      why_we_beat_them: z.string().nullable(),
    })
  ),
  differentiators: z
    .array(z.string().min(1))
    .min(1, "At least one differentiator")
    .max(10),
});

export type BrandPositioning = z.infer<typeof brandPositioningSchema>;

export async function getBrandPositioning(
  tenantSlug: string
): Promise<BrandPositioning | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (error || !data?.settings) return null;
  const parsed = brandPositioningSchema.safeParse(
    (data.settings as { brand_positioning?: unknown }).brand_positioning
  );
  return parsed.success ? parsed.data : null;
}

export function isBrandPositioningComplete(
  value: unknown
): value is BrandPositioning {
  return brandPositioningSchema.safeParse(value).success;
}

/**
 * One-shot combined loader — both voice and positioning in a single
 * Supabase round-trip. Every new AI call site uses this instead of
 * loading them separately.
 */
export interface BrandContext {
  voice: BrandVoice | null;
  positioning: BrandPositioning | null;
}

export async function getBrandContext(
  tenantSlug: string
): Promise<BrandContext> {
  const [voice, positioning] = await Promise.all([
    getBrandVoice(tenantSlug),
    getBrandPositioning(tenantSlug),
  ]);
  return { voice, positioning };
}

/**
 * Render a positioning block for inclusion in AI prompts. Returns a
 * sensible fallback string when positioning is null so callers don't
 * branch. Keep in sync with the rubric's Brand Alignment inputs.
 */
export function buildPositioningBlock(
  positioning: BrandPositioning | null
): string {
  if (!positioning) {
    return "No brand positioning configured — write for a general business audience; stay neutral on competitors; don't invent claims.";
  }
  const lines: string[] = [
    "Brand positioning:",
    `- Mission: ${positioning.mission}`,
    `- Value proposition: ${positioning.value_proposition}`,
    `- Differentiators: ${positioning.differentiators.join(" | ")}`,
  ];

  if (positioning.topics_to_cover.length > 0) {
    lines.push(`- Topics we cover: ${positioning.topics_to_cover.join(", ")}`);
  }
  if (positioning.topics_to_avoid.length > 0) {
    lines.push(
      `- **DO NOT cover**: ${positioning.topics_to_avoid.join(", ")}`
    );
  }
  if (positioning.target_demographics.length > 0) {
    lines.push("- Target audience:");
    for (const d of positioning.target_demographics) {
      lines.push(
        `    • ${d.segment} — pain points: ${d.pain_points.join("; ")}`
      );
    }
  }
  if (positioning.competitors.length > 0) {
    const named = positioning.competitors
      .slice(0, 5)
      .map((c) => (c.domain ? `${c.name} (${c.domain})` : c.name))
      .join(", ");
    lines.push(`- Competitors we benchmark: ${named}`);
  }
  return lines.join("\n");
}
