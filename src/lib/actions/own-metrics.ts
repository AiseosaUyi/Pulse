"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseCsv } from "@/lib/ai/csv-maps";
import { extractMetricsFromScreenshot } from "@/lib/ai/extract-post-metrics";
import type {
  OwnMetricsPlatform,
  OwnMetricsPayload,
} from "@/lib/types/own-metrics";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export async function uploadCsv(
  tenantSlug: string,
  platform: OwnMetricsPlatform,
  csvText: string
): Promise<ActionResult<{ inserted: number; skipped: number; unrecognizedHeaders: string[] }>> {
  if (!csvText.trim()) return { success: false, error: "CSV is empty" };
  const parsed = parseCsv(platform, csvText);
  if (parsed.rows.length === 0) {
    return {
      success: false,
      error: `No rows parsed. Headers not recognized: ${parsed.unrecognizedHeaders.join(", ") || "none"}`,
    };
  }

  const supabase = await createClient();
  const rows = parsed.rows
    .filter((r) => Object.keys(r.metrics).length > 0)
    .map((r) => ({
      tenant_slug: tenantSlug,
      platform,
      external_url: r.externalUrl ?? null,
      title: r.title ?? null,
      caption: r.caption ?? null,
      captured_at: r.postedAt ? new Date(r.postedAt).toISOString() : new Date().toISOString(),
      source: "csv" as const,
      metrics: r.metrics,
    }));

  if (rows.length === 0) {
    return {
      success: false,
      error: `Parsed ${parsed.rows.length} row(s) but none had recognizable metrics. Unrecognized headers: ${parsed.unrecognizedHeaders.join(", ")}`,
    };
  }

  const { error } = await supabase.from("own_post_metrics").insert(rows);
  if (error) return { success: false, error: error.message };

  revalidatePath("/own-analytics");
  revalidatePath("/dashboard");
  return {
    success: true,
    inserted: rows.length,
    skipped: parsed.rows.length - rows.length,
    unrecognizedHeaders: parsed.unrecognizedHeaders,
  };
}

export async function uploadScreenshot(
  tenantSlug: string,
  platformHint: OwnMetricsPlatform | null,
  imageBase64: string
): Promise<ActionResult<{ metricId: string; extracted: OwnMetricsPayload; platform: OwnMetricsPlatform }>> {
  if (!imageBase64 || !imageBase64.startsWith("data:image/")) {
    return { success: false, error: "Invalid image data" };
  }

  try {
    const extracted = await extractMetricsFromScreenshot({
      tenantSlug,
      imageBase64,
      hintPlatform: platformHint ?? undefined,
    });

    if (Object.keys(extracted.metrics).length === 0) {
      return {
        success: false,
        error: "Could not read any metrics from that screenshot. Make sure the numbers are visible and not cropped.",
      };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("own_post_metrics")
      .insert({
        tenant_slug: tenantSlug,
        platform: extracted.platform,
        caption: extracted.caption,
        captured_at: extracted.postedAt
          ? new Date(extracted.postedAt).toISOString()
          : new Date().toISOString(),
        source: "screenshot",
        metrics: extracted.metrics,
      })
      .select("id")
      .single();

    if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };

    revalidatePath("/own-analytics");
    revalidatePath("/dashboard");
    return {
      success: true,
      metricId: data.id,
      extracted: extracted.metrics,
      platform: extracted.platform,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Extraction failed",
    };
  }
}

export async function deleteOwnMetric(
  id: string,
  tenantSlug: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("own_post_metrics")
    .delete()
    .eq("id", id)
    .eq("tenant_slug", tenantSlug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/own-analytics");
  return { success: true };
}
