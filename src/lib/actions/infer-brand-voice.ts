"use server";

import { z } from "zod";
import { generateText, Output } from "ai";
import { getCurrentTenant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listBlogPosts } from "@/lib/services/blog-posts";
import { getModel, estimateCostUsd, logAiCall } from "@/lib/ai/gateway";

// OpenAI strict mode requires nullable, not optional.
const InferredVoiceSchema = z.object({
  tone: z.string().nullable(),
  audience: z.string().nullable(),
  do_list: z.array(z.string()).nullable(),
  dont_list: z.array(z.string()).nullable(),
  example_posts: z.array(z.string()).nullable(),
});

export async function inferBrandVoiceFromPosts(): Promise<
  | { success: true; voice: { tone: string; audience: string; do_list: string[]; dont_list: string[]; example_posts: string[] } }
  | { success: false; error: string }
> {
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "Not authenticated." };

  const posts = await listBlogPosts(tenant.slug, { status: "published", limit: 20 });
  if (posts.length < 3) {
    return { success: false, error: `Need at least 3 published blog posts to infer voice (you have ${posts.length}).` };
  }

  const excerpts = posts
    .map((p, i) => `Post ${i + 1}: "${p.title}"\n${(p.content ?? "").slice(0, 500)}`)
    .join("\n\n---\n\n");

  const model = getModel("synthesis");
  const start = Date.now();
  let result;
  try {
    result = await generateText({
      model,
      output: Output.object({ schema: InferredVoiceSchema }),
      system: `You are a brand strategist. Analyse the writing samples and extract the brand's voice characteristics.
Return concrete, specific observations — not generic marketing speak.`,
      prompt: `Analyse these ${posts.length} published blog posts and extract the brand voice:\n\n${excerpts}\n\nReturn:\n- tone: 1-2 sentence description of the writing tone and personality\n- audience: who these posts are written for (age range, interests, platform)\n- do_list: 4-6 specific stylistic things the brand consistently does\n- dont_list: 3-5 things the brand avoids or never does\n- example_posts: pick the 2 best excerpt openings (max 120 chars each) that capture the voice`,
    });
  } catch (err) {
    await logAiCall({
      tenantSlug: tenant.slug,
      purpose: "synthesis",
      feature: "brand_voice_infer",
      model: "gpt-4.1",
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    });
    return { success: false, error: "AI inference failed. Try again." };
  }

  const durationMs = Date.now() - start;
  const usage = result.usage;
  await logAiCall({
    tenantSlug: tenant.slug,
    purpose: "synthesis",
    feature: "brand_voice_infer",
    model: "gpt-4.1",
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    costUsd: estimateCostUsd("gpt-4.1", {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    }),
    durationMs,
    success: true,
  });

  const obj = result.output;
  const voice = {
    tone: obj.tone ?? "",
    audience: obj.audience ?? "",
    do_list: obj.do_list ?? [],
    dont_list: obj.dont_list ?? [],
    example_posts: obj.example_posts ?? [],
  };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("tenants")
    .select("settings")
    .eq("slug", tenant.slug)
    .maybeSingle();

  const existing = (row?.settings as Record<string, unknown>) ?? {};
  await admin
    .from("tenants")
    .update({ settings: { ...existing, brand_voice: voice } })
    .eq("slug", tenant.slug);

  return { success: true, voice };
}
