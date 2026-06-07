// Post embedding write path (PULSE-SEO-SPEC.md §10). Embeds a published
// post once, on publish only (NOT per editor save). Internal-link
// recommendations cosine-search seo_post_embeddings (HNSW, mig 046).
//
// gateway.ts already names this module: getModel("seo-embedding") is a
// sentinel; the real call lives here.

import "server-only";
import { createHash } from "node:crypto";
import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { createAdminClient } from "@/lib/supabase/admin";
import { estimateCostUsd, getModelId, logAiCall } from "@/lib/ai/gateway";

const MODEL = "text-embedding-3-large";
// 1536 dims (NOT the 3072 default): pgvector HNSW indexes cap at 2000
// dimensions, so vector(3072)+HNSW is impossible. text-embedding-3-large
// supports dimension reduction with negligible quality loss (mig 046).
const DIMENSIONS = 1536;

/** Normalize body text so cosmetic edits don't churn embeddings. */
function normalize(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[#*_`>~]/g, "")
    .trim()
    .toLowerCase();
}

export function contentHash(bodyText: string): string {
  return createHash("sha256").update(normalize(bodyText)).digest("hex");
}

/** pgvector literal: '[v1,v2,...]'. */
function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

export interface EmbedSeoPostInput {
  tenantSlug: string;
  blogPostId: string;
  slug: string;
  /** Plain body text (markdown is fine — it's normalized). */
  bodyText: string;
}

export interface EmbedSeoPostResult {
  status: "embedded" | "unchanged";
  contentHash: string;
}

/**
 * Idempotent: if the stored content_hash matches, skips the API call.
 * Safe to re-run inside the publish runner's `embed` step.
 */
export async function embedSeoPost(
  input: EmbedSeoPostInput
): Promise<EmbedSeoPostResult> {
  const supabase = createAdminClient();
  const hash = contentHash(input.bodyText);

  const { data: existing } = await supabase
    .from("seo_post_embeddings")
    .select("content_hash")
    .eq("tenant_slug", input.tenantSlug)
    .eq("slug", input.slug)
    .maybeSingle();

  if (existing?.content_hash === hash) {
    return { status: "unchanged", contentHash: hash };
  }

  const started = Date.now();
  try {
    const { embedding, usage } = await embed({
      model: openai.textEmbeddingModel(MODEL),
      value: normalize(input.bodyText),
      providerOptions: { openai: { dimensions: DIMENSIONS } },
    });

    const tokens = usage?.tokens ?? 0;
    const modelId = getModelId("seo-embedding");

    const { error: upsertErr } = await supabase
      .from("seo_post_embeddings")
      .upsert(
        {
          tenant_slug: input.tenantSlug,
          blog_post_id: input.blogPostId,
          slug: input.slug,
          content_hash: hash,
          embedding: toVectorLiteral(embedding),
          model: modelId,
          dimensions: embedding.length,
          embedded_at: new Date().toISOString(),
        },
        { onConflict: "tenant_slug,slug" }
      );

    if (upsertErr) throw new Error(`embedding upsert: ${upsertErr.message}`);

    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "seo-embedding",
      feature: "seo_post_embed",
      model: modelId,
      inputTokens: tokens,
      costUsd: estimateCostUsd(modelId, {
        inputTokens: tokens,
        outputTokens: 0,
      }),
      durationMs: Date.now() - started,
      success: true,
    });

    return { status: "embedded", contentHash: hash };
  } catch (err) {
    await logAiCall({
      tenantSlug: input.tenantSlug,
      purpose: "seo-embedding",
      feature: "seo_post_embed",
      model: getModelId("seo-embedding"),
      durationMs: Date.now() - started,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
