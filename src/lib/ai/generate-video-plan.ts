// Content Engine generator. Produces a batch of N short-form video
// plans, each tied to ONE pre-selected format template. Format
// selection happens in code (see pickForGeneration) so we don't bias
// toward whichever format the model "likes."
//
// Each plan emits a ready-to-paste creative prompt for Seedance /
// Kling / manual editing, plus predicted virality / education /
// conversion scores in the same call (no second scoring pass — keeps
// cost down).

import { generateText, Output } from "ai";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  estimateCostUsd,
  getModel,
  getModelId,
  logAiCall,
} from "@/lib/ai/gateway";
import {
  buildPositioningBlock,
  getBrandContext,
} from "@/lib/ai/brand-positioning";
import {
  listForTenantAdmin,
  pickForGeneration,
} from "@/lib/services/content-format-templates";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ContentFormatTemplate,
  ContentPlan,
  PlanPlatform,
} from "@/lib/types/content-engine";

// ── output schema ───────────────────────────────────────────
// Per CLAUDE.md: every property is required-but-nullable when
// optional. `.optional()` and `.default()` break OpenAI strict mode.
const sceneSchema = z.object({
  scene: z.number().int().min(1),
  description: z
    .string()
    .min(10)
    .describe(
      "What the camera shows. Specific. Reference characters, setting, props by the same name across all scenes."
    ),
  dialogue: z
    .string()
    .nullable()
    .describe(
      "Exact spoken or on-screen text for this scene. Null when scene has none."
    ),
  camera: z
    .string()
    .min(3)
    .describe("Camera angle, lens, motion, framing for this scene."),
  emotion: z
    .string()
    .min(3)
    .describe("The intended emotional beat for the viewer."),
});

export const planSchema = z.object({
  hook: z
    .string()
    .min(8)
    .describe(
      "First 1-3 seconds. The pattern-break that stops the scroll. No hashtags, no fluff."
    ),
  duration_seconds: z
    .number()
    .int()
    .min(3)
    .max(120)
    .describe(
      "Total video duration in seconds. Must fall within the format's duration range."
    ),
  scenes: z
    .array(sceneSchema)
    .min(1)
    .describe(
      "Ordered scenes. Same character(s), tone, and visual world across every scene."
    ),
  tone: z
    .string()
    .min(3)
    .describe("One short phrase describing the overall tone."),
  ready_prompt: z
    .string()
    .min(50)
    .describe(
      "A complete, paste-ready creative prompt for Seedance or Kling. Include character description, setting, lighting, camera, scene-by-scene action, dialogue, music vibe. No Pulse internals."
    ),
  suggested_tool: z
    .enum(["seedance", "kling", "manual", "capcut"])
    .describe(
      "Which tool will produce the most human-looking output for this plan: seedance (product motion, polished b-roll), kling (human characters, dialogue, expressive faces), manual (real footage), capcut (assemble + caption pre-shot)."
    ),
  suggested_tool_reason: z
    .string()
    .min(10)
    .describe("One short sentence explaining the tool choice."),
  predicted_virality: z
    .number()
    .int()
    .min(0)
    .max(10)
    .describe(
      "0-10. Likelihood this gets >10x normal reach. Calibrate against this brand's recent performance."
    ),
  predicted_education: z
    .number()
    .int()
    .min(0)
    .max(10)
    .describe("0-10. How much the viewer learns or understands after watching."),
  predicted_conversion: z
    .number()
    .int()
    .min(0)
    .max(10)
    .describe(
      "0-10. Likelihood the viewer clicks through, buys, or signs up after watching."
    ),
});

export type PlanOutputJson = z.infer<typeof planSchema>;

export class VideoPlanGenerationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "VideoPlanGenerationError";
  }
}

interface RecentPostSnippet {
  title: string;
  reach: number;
  likes: number;
  saves: number;
}

async function getRecentPerformance(
  tenantSlug: string,
  platform: string
): Promise<{ top: RecentPostSnippet[]; bottom: RecentPostSnippet[] }> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const { data } = await admin
    .from("posts")
    .select("title, reach, likes, saves, posted_at")
    .eq("tenant_slug", tenantSlug)
    .eq("platform", platform)
    .gte("posted_at", since)
    .order("reach", { ascending: false })
    .limit(20);

  const rows = (data ?? []) as RecentPostSnippet[];
  return {
    top: rows.slice(0, 5),
    bottom: rows.slice(-2),
  };
}

function buildSystemPrompt(
  tenantName: string,
  platform: string,
  voiceBlock: string,
  positioningBlock: string,
  perf: { top: RecentPostSnippet[]; bottom: RecentPostSnippet[] }
): string {
  const lines: string[] = [
    `You are generating a single short-form video plan for ${tenantName}.`,
    "",
    voiceBlock,
    "",
    positioningBlock,
    "",
    `RECENT PERFORMANCE (last 14 days, ${platform}):`,
  ];
  if (perf.top.length === 0 && perf.bottom.length === 0) {
    lines.push("- No recent posts on this platform yet. Use brand voice + format alone.");
  } else {
    if (perf.top.length > 0) {
      lines.push("Top performing:");
      for (const p of perf.top) {
        lines.push(
          `- "${p.title}" — reach ${p.reach}, likes ${p.likes}, saves ${p.saves}`
        );
      }
    }
    if (perf.bottom.length > 0) {
      lines.push("Underperformed:");
      for (const p of perf.bottom) {
        lines.push(
          `- "${p.title}" — reach ${p.reach}, likes ${p.likes}`
        );
      }
    }
  }
  lines.push(
    "",
    "Ground rules:",
    "- You will be given EXACTLY ONE format. Do NOT change the format name, structure, or duration range.",
    "- Keep characters, setting, props, and tone consistent across every scene.",
    "- The `ready_prompt` field must be paste-ready for Seedance or Kling — full creative direction, no Pulse-isms, no system instructions, no meta commentary.",
    "- Pick the suggested tool that yields the most human-looking output for THIS plan, not the most flexible one in general.",
    "- Predicted scores 0-10 must be calibrated against the brand's recent performance. If recent posts averaged 1k reach, a 9/10 virality score means you genuinely expect ~10k+.",
    "- Never invent claims, stats, or quotes the brand hasn't made.",
  );
  return lines.join("\n");
}

function buildUserPrompt(
  template: ContentFormatTemplate,
  platform: string,
  goal: string | undefined
): string {
  const t = {
    name: template.name,
    description: template.description,
    category: template.category,
    duration_range_seconds: `${template.durationMin}-${template.durationMax}`,
    structure: template.structure,
    tone: template.tone,
    default_scenes: template.defaultScenes,
    example_hook: template.exampleHook,
    example_script: template.exampleScript,
  };
  return [
    "FORMAT (use exactly this — do not deviate from name, structure, or duration range):",
    "```json",
    JSON.stringify(t, null, 2),
    "```",
    "",
    `PLATFORM: ${platform}`,
    goal ? `GOAL: ${goal}` : "GOAL: engagement",
    "",
    "Generate the plan as structured JSON.",
  ].join("\n");
}

interface GenerateBatchInput {
  tenantSlug: string;
  platform: PlanPlatform;
  count?: number;
  goal?: "engagement" | "conversion" | "awareness";
  createdBy?: string | null;
}

interface GenerateBatchResult {
  batchId: string;
  plans: ContentPlan[];
}

export async function generatePlanBatch(
  input: GenerateBatchInput
): Promise<GenerateBatchResult> {
  const count = input.count ?? 3;

  // 1. fetch templates + tenant brand + recent performance in parallel
  const [templates, brand, perf] = await Promise.all([
    listForTenantAdmin(input.tenantSlug, "video"),
    getBrandContext(input.tenantSlug),
    getRecentPerformance(input.tenantSlug, input.platform),
  ]);

  const active = templates.filter((t) => t.isActive);
  if (active.length === 0) {
    throw new VideoPlanGenerationError(
      "No active video formats for this tenant. Activate one in Settings → Content Engine."
    );
  }

  // 2. format selection happens here — not in the model
  const picked = pickForGeneration(active, count);
  if (picked.length === 0) {
    throw new VideoPlanGenerationError("Could not pick any formats — all inactive?");
  }

  // 3. tenant display name
  const admin = createAdminClient();
  const { data: tenantRow } = await admin
    .from("tenants")
    .select("name")
    .eq("slug", input.tenantSlug)
    .maybeSingle();
  const tenantName = tenantRow?.name ?? input.tenantSlug;

  // 4. shared system prompt across the batch
  const voiceBlock = brand.voice
    ? [
        "Brand voice:",
        `- Tone: ${brand.voice.tone}`,
        `- Audience: ${brand.voice.audience}`,
        `- Do: ${brand.voice.do_list.join(" | ")}`,
        `- Don't: ${brand.voice.dont_list.join(" | ")}`,
      ].join("\n")
    : "Brand voice: not configured — write in a clean, friendly, brand-neutral tone.";
  const positioningBlock = buildPositioningBlock(brand.positioning);

  const system = buildSystemPrompt(
    tenantName,
    input.platform,
    voiceBlock,
    positioningBlock,
    perf
  );

  // 5. parallel generation
  const model = getModel("synthesis");
  const modelId = getModelId("synthesis");

  const generatedAt = new Date().toISOString();
  const batchId = randomUUID();

  const oneShot = async (
    template: ContentFormatTemplate
  ): Promise<{
    template: ContentFormatTemplate;
    output: PlanOutputJson;
    cost: number;
  }> => {
    const started = Date.now();
    const userPrompt = buildUserPrompt(template, input.platform, input.goal);

    try {
      const result = await generateText({
        model,
        output: Output.object({ schema: planSchema }),
        system,
        prompt: userPrompt,
      });

      const usage = result.usage ?? { inputTokens: 0, outputTokens: 0 };
      const meta = (result.providerMetadata?.openai ?? {}) as {
        cachedPromptTokens?: number;
      };
      const cacheRead = meta.cachedPromptTokens ?? 0;
      const cost = estimateCostUsd(modelId, {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: cacheRead,
      });

      await logAiCall({
        tenantSlug: input.tenantSlug,
        purpose: "synthesis",
        feature: "content_plan_generate",
        model: modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: cacheRead,
        costUsd: cost,
        durationMs: Date.now() - started,
        success: true,
      });

      return { template, output: result.output, cost };
    } catch (err) {
      await logAiCall({
        tenantSlug: input.tenantSlug,
        purpose: "synthesis",
        feature: "content_plan_generate",
        model: modelId,
        durationMs: Date.now() - started,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw new VideoPlanGenerationError(
        `Failed to generate plan for "${template.name}"`,
        err
      );
    }
  };

  const settled = await Promise.allSettled(picked.map(oneShot));
  const successes = settled
    .filter(
      (s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof oneShot>>> =>
        s.status === "fulfilled"
    )
    .map((s) => s.value);

  if (successes.length === 0) {
    const firstReason = settled.find((s) => s.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    throw new VideoPlanGenerationError(
      "All plan generations failed",
      firstReason?.reason
    );
  }

  // 6. insert into content_plans
  const insertRows = successes.map(({ template, output, cost }) => ({
    tenant_slug: input.tenantSlug,
    template_id: template.id,
    template_name: template.name,
    template_category: template.category,
    medium: "video" as const,
    platform: input.platform,
    output: {
      hook: output.hook,
      durationSeconds: output.duration_seconds,
      scenes: output.scenes,
      tone: output.tone,
      readyPrompt: output.ready_prompt,
    },
    predicted_virality: output.predicted_virality,
    predicted_education: output.predicted_education,
    predicted_conversion: output.predicted_conversion,
    suggested_tool: output.suggested_tool,
    suggested_tool_reason: output.suggested_tool_reason,
    status: "draft" as const,
    feedback: "none" as const,
    generator_model: modelId,
    generator_cost_usd: cost,
    batch_id: batchId,
    created_by: input.createdBy ?? null,
  }));

  const { data: inserted, error: insertErr } = await admin
    .from("content_plans")
    .insert(insertRows)
    .select("*");

  if (insertErr || !inserted) {
    throw new VideoPlanGenerationError(
      `Insert failed: ${insertErr?.message ?? "unknown"}`
    );
  }

  // 7. update last_generated_at on used templates so the rotator
  //    moves on next time.
  await admin
    .from("content_format_templates")
    .update({ last_generated_at: generatedAt })
    .in(
      "id",
      successes.map((s) => s.template.id)
    );

  return {
    batchId,
    plans: inserted.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id as string,
        tenantSlug: r.tenant_slug as string,
        templateId: (r.template_id as string | null) ?? null,
        templateName: r.template_name as string,
        templateCategory: (r.template_category as string | null) ?? null,
        medium: "video" as const,
        platform: r.platform as string,
        output: r.output as ContentPlan["output"],
        predictedVirality: (r.predicted_virality as number | null) ?? null,
        predictedEducation: (r.predicted_education as number | null) ?? null,
        predictedConversion: (r.predicted_conversion as number | null) ?? null,
        suggestedTool: (r.suggested_tool as ContentPlan["suggestedTool"]) ?? null,
        suggestedToolReason: (r.suggested_tool_reason as string | null) ?? null,
        status: r.status as ContentPlan["status"],
        feedback: r.feedback as ContentPlan["feedback"],
        feedbackNotes: (r.feedback_notes as string | null) ?? null,
        generatorModel: (r.generator_model as string | null) ?? null,
        generatorCostUsd:
          r.generator_cost_usd != null
            ? Number(r.generator_cost_usd)
            : null,
        batchId: r.batch_id as string,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
      };
    }),
  };
}
