// Sweeps due scheduled posts into the publish runner (PULSE-SEO-SPEC.md
// §12). Bearer-gated like every cron. One cron_runs row per invocation.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyFromRequest } from "@/lib/cron/auth";
import { withCronRun } from "@/lib/cron/run-tracker";
import { runPublish } from "@/lib/seo/publish-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const gate = verifyFromRequest(req);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const result = await withCronRun("seo-publish-sweep", async () => {
    const admin = createAdminClient();
    const { data: due } = await admin
      .from("blog_posts")
      .select("id")
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date().toISOString())
      .limit(25);

    const posts = due ?? [];
    let ok = 0;
    let failed = 0;
    for (const p of posts) {
      const r = await runPublish({ blogPostId: p.id });
      if (r.status === "succeeded") ok++;
      else failed++;
    }
    return {
      status: failed > 0 && ok > 0 ? "partial" : failed > 0 ? "failed" : "ok",
      rowsProcessed: posts.length,
      metadata: { ok, failed },
    };
  });

  return NextResponse.json(result);
}
