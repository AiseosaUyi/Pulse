// Backstop for video generation. The client poll drives a project while the
// editor watches; this cron advances any project still 'generating' when no one
// is looking (closed tab, etc.) and recovers stuck render jobs. Idempotent —
// advanceGeneration is safe to call repeatedly.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { advanceGeneration } from "@/lib/video/video-generation-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PROJECTS = 20; // per invocation

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const result = await withCronRun("video-maintenance", async () => {
    const admin = createAdminClient();
    const summary = { advanced: 0, assembled: 0, failed: 0, errors: [] as string[] };

    const { data: projects } = await admin
      .from("video_projects")
      .select("id")
      .eq("status", "generating")
      .order("updated_at", { ascending: true })
      .limit(MAX_PROJECTS);

    for (const p of (projects ?? []) as { id: string }[]) {
      try {
        const r = await advanceGeneration(p.id);
        summary.advanced += 1;
        if (r.status === "assembled") summary.assembled += 1;
        if (r.status === "generation_failed") summary.failed += 1;
      } catch (err) {
        summary.failed += 1;
        summary.errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    const status = summary.errors.length === 0 ? "ok" : summary.advanced > 0 ? "partial" : "failed";
    return { status, rowsProcessed: summary.advanced, metadata: summary };
  });

  return NextResponse.json(result.metadata ?? result);
}
