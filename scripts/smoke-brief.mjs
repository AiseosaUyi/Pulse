// One-off live smoke test for F2 brief generation.
// Run: node --env-file=.env.local scripts/smoke-brief.mjs
//
// Populates a minimal brand_voice for gruve, picks an existing intel_card,
// and calls the AI Gateway to generate a brief. Does NOT insert — just
// verifies the AI call works end-to-end.

import { createClient } from "@supabase/supabase-js";
import { generateText, Output } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const SMOKE_VOICE = {
  tone: "Playful, irreverent, Lagos-native",
  audience: "18-35, event enthusiasts in Lagos, Instagram-heavy",
  do_list: [
    "Lead with atmosphere, not price",
    "Reference local context (Lagos, afrobeats, nightlife)",
    "Short punchy sentences",
  ],
  dont_list: [
    "Never sound corporate",
    "No emoji-heavy headlines",
    "Avoid jargon",
  ],
  example_posts: [
    "Sunset hits different at 2,000ft. Find us tonight.",
    "The DJ dropped at 2am and nobody remembered their own name 🔥",
  ],
};

async function main() {
  // 1. Set brand voice on gruve
  const { data: tenant } = await admin
    .from("tenants")
    .select("settings")
    .eq("slug", "gruve")
    .single();
  const settings = { ...(tenant?.settings ?? {}), brand_voice: SMOKE_VOICE };
  const { error: sErr } = await admin
    .from("tenants")
    .update({ settings })
    .eq("slug", "gruve");
  if (sErr) throw sErr;
  console.log("brand voice set on gruve");

  // 2. Pick a gruve intel_card
  const { data: cards, error: cErr } = await admin
    .from("intel_cards")
    .select("*")
    .eq("tenant_id", "gruve")
    .order("detected_at", { ascending: false })
    .limit(1);
  if (cErr) throw cErr;
  const card = cards?.[0];
  if (!card) throw new Error("no intel_cards for gruve");
  console.log(`picked card: ${card.competitor_name} / ${card.platform} / ${card.content_type}`);

  // 3. Call AI Gateway
  const briefSchema = z.object({
    title: z.string(),
    outline: z.array(z.string()),
    draftContent: z.string(),
    seoKeywords: z.array(z.string()).optional().default([]),
  });

  const started = Date.now();
  const result = await generateText({
    model: openai("gpt-5"),
    output: Output.object({ schema: briefSchema }),
    system: [
      `You generate content briefs for Gruve.`,
      `Brand voice:`,
      `- Tone: ${SMOKE_VOICE.tone}`,
      `- Audience: ${SMOKE_VOICE.audience}`,
      `- Do: ${SMOKE_VOICE.do_list.join(" | ")}`,
      `- Don't: ${SMOKE_VOICE.dont_list.join(" | ")}`,
      ``,
      `Examples of our voice:`,
      ...SMOKE_VOICE.example_posts.map((p, i) => `  ${i + 1}. ${p}`),
    ].join("\n"),
    prompt: [
      `Pattern observed this week:`,
      `${card.platform} ${card.content_type} from ${card.competitor_name}`,
      ``,
      `Top post: ${card.summary}`,
      `Engagement rate: ${card.metrics?.engagementRate ?? "n/a"}%`,
      ``,
      `Draft a brief applying this pattern to Gruve in our voice.`,
    ].join("\n"),
  });
  const elapsed = Date.now() - started;

  console.log(`--- BRIEF (${elapsed}ms) ---`);
  console.log(`title: ${result.output.title}`);
  console.log(`outline:`);
  for (const item of result.output.outline) console.log(`  - ${item}`);
  console.log(`draft:`);
  console.log(result.output.draftContent);
  console.log(`--- usage ---`);
  console.log(result.usage);
  if (result.providerMetadata?.openai) {
    console.log(`cache:`, {
      cachedPromptTokens: result.providerMetadata.openai.cachedPromptTokens,
    });
  }
}

main().catch((e) => {
  console.error("SMOKE FAILED:", e.message ?? e);
  process.exit(1);
});
