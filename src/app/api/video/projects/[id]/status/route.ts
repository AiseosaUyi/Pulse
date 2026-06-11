// Client-poll driver. The project detail page polls this every few seconds
// while a project is generating; each call advances the runner one step and
// returns the live state. Auth: the caller must be a member of the project's
// tenant (RLS on the read below enforces it).

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { advanceGeneration } from "@/lib/video/video-generation-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const supabase = await createClient();
  // RLS: returns the row only if the user is a member of its tenant.
  const { data: project } = await supabase
    .from("video_projects")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Only advance while generating; otherwise just report state.
  let result;
  if (project.status === "generating") {
    result = await advanceGeneration(id);
  } else {
    const { data: clips } = await supabase
      .from("video_clips")
      .select("status")
      .eq("project_id", id);
    const total = clips?.length ?? 0;
    const ready = (clips ?? []).filter((c) => c.status === "ready").length;
    result = {
      projectId: id,
      status: project.status,
      clipsReady: ready,
      clipsTotal: total,
      done: ["assembled", "exported"].includes(project.status as string),
      pending: false,
    };
  }

  return NextResponse.json(result);
}
