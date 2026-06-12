// Consolidated daily SEO maintenance. Vercel Hobby restricts crons to
// daily frequency + a low total count, so all six SEO jobs run from one
// daily cron instead of six. Each step is isolated (one failure doesn't
// abort the rest); the aggregate status is reported to cron_runs.
//
// Individual /api/cron/seo-* routes remain for manual/on-demand trigger
// (e.g. forcing a publish sweep) — they're just no longer scheduled.

import { sweepDuePublishes } from "@/lib/seo/publish-runner";
import { captureDueOutcomes } from "@/lib/seo/rec-outcomes";
import {
  generateRecommendations,
  generateKeywordCaptureRecs,
} from "@/lib/seo/rec-generator";
import { detectDecay } from "@/lib/seo/detect-decay";
import { processUnprocessedBeacons } from "@/lib/seo/beacon-normalizer";
import { sweepPreviewJti } from "@/lib/seo/preview-token";
import { syncSearchConsole } from "@/lib/seo/gsc-sync";
import { syncAiVisibility } from "@/lib/seo/ai-visibility-sync";

type StepResult = { ok: boolean; detail: unknown };

async function step(
  name: string,
  fn: () => Promise<unknown>
): Promise<[string, StepResult]> {
  try {
    return [name, { ok: true, detail: await fn() }];
  } catch (e) {
    return [
      name,
      { ok: false, detail: e instanceof Error ? e.message : String(e) },
    ];
  }
}

export async function runSeoMaintenance(): Promise<{
  status: "ok" | "partial" | "failed";
  rowsProcessed: number;
  metadata: Record<string, unknown>;
}> {
  // Order: publish first (time-sensitive), then derived/analytics jobs,
  // then cleanup.
  // GSC sync runs FIRST and is awaited before rec generation so the
  // keyword_capture emitter sees the freshly upserted ranking rows.
  const gscResult = await step("gsc_sync", () => syncSearchConsole());

  const results = Object.fromEntries([
    gscResult,
    ...(await Promise.all([
      step("publish_sweep", () => sweepDuePublishes()),
      step("rec_outcomes", () => captureDueOutcomes()),
      step("rec_generate", () => generateRecommendations()),
      step("keyword_capture", () => generateKeywordCaptureRecs()),
      step("ai_visibility", () => syncAiVisibility()),
      step("decay_detect", () => detectDecay()),
      step("beacon_process", () => processUnprocessedBeacons()),
      step("preview_jti_sweep", async () => ({
        deleted: await sweepPreviewJti(),
      })),
    ])),
  ]);

  const vals = Object.values(results) as StepResult[];
  const failed = vals.filter((r) => !r.ok).length;
  const status =
    failed === 0 ? "ok" : failed === vals.length ? "failed" : "partial";

  return {
    status,
    rowsProcessed: vals.length,
    metadata: { steps: results, failed },
  };
}
