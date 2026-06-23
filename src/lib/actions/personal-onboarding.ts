"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { brandVoiceSchema } from "@/lib/ai/brand-voice";
import { brandPositioningSchema } from "@/lib/ai/brand-positioning";
import { defaultCadenceConfig } from "@/lib/cadence/types";

type ActionResult = { success: true } | { success: false; error: string };

export interface PersonalOnboardingInput {
  /** What the person posts about — their content pillars. */
  pillars: string[];
  /** One-sentence description of their voice/vibe. */
  vibe: string;
  /** At least one example post in their voice. */
  examplePosts: string[];
  /** Optional IANA timezone for the cadence default. */
  timezone?: string;
}

/**
 * Individual setup: turn a few answers into a brand_voice + brand_positioning
 * (so the Composer's AI context works exactly like a startup's) plus a default,
 * disabled cadence config. Sets brand voice, which the (app) layout gate uses to
 * consider the account onboarded.
 */
export async function savePersonalOnboarding(
  tenantSlug: string,
  input: PersonalOnboardingInput
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const pillars = input.pillars.map((p) => p.trim()).filter(Boolean).slice(0, 12);
  const vibe = input.vibe.trim();
  const examples = input.examplePosts.map((p) => p.trim()).filter(Boolean).slice(0, 5);

  if (pillars.length === 0) return { success: false, error: "Add at least one thing you post about." };
  if (!vibe) return { success: false, error: "Describe your voice in a sentence." };
  if (examples.length === 0) return { success: false, error: "Add at least one example post." };

  const pillarList = pillars.join(", ");

  // Synthesize a brand voice + positioning from the answers. These satisfy the
  // shared schemas so every AI call (the Composer) has real context.
  const voice = {
    tone: vibe,
    audience: `People who follow me for takes on ${pillarList}`,
    do_list: ["Sound like a real person with a point of view", "Keep it tight and specific"],
    dont_list: ["No corporate speak", "No generic filler or hype"],
    example_posts: examples,
  };
  const positioning = {
    mission: `Build a personal brand around ${pillarList}.`,
    value_proposition: `Consistent, in-voice takes on ${pillarList} that build credibility over time.`,
    target_demographics: [
      { segment: "My audience", pain_points: ["Finding people worth following", "Signal over noise"] },
    ],
    topics_to_cover: pillars,
    topics_to_avoid: [],
    competitors: [],
    differentiators: ["An authentic, recognizable personal voice"],
  };

  // Defensive: validate against the shared schemas before persisting.
  if (!brandVoiceSchema.safeParse(voice).success || !brandPositioningSchema.safeParse(positioning).success) {
    return { success: false, error: "Couldn't build your profile from those answers." };
  }

  const supabase = await createClient();
  const { data: tenant, error: readError } = await supabase
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (readError) return { success: false, error: readError.message };

  const existing = (tenant?.settings as Record<string, unknown>) ?? {};
  const merged = {
    ...existing,
    brand_voice: voice,
    brand_positioning: positioning,
    cadence: defaultCadenceConfig(input.timezone),
    individual_onboarded: true,
  };

  const { error: writeError } = await supabase
    .from("tenants")
    .update({ settings: merged })
    .eq("slug", tenantSlug);
  if (writeError) return { success: false, error: writeError.message };

  redirect("/composer");
}
