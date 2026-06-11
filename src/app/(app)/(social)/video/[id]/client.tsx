"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Film, Loader2 } from "lucide-react";
import {
  submitForReview,
  approveProject,
  requestChanges,
  startGeneration,
  retryGeneration,
  exportProject,
  regenerateStoryboard,
} from "@/lib/actions/video-projects";
import { toast } from "@/components/ui/Toaster";
import type { VideoProject, VideoClip } from "@/lib/types/video";

const CLIP_STATUS: Record<string, string> = {
  planned: "Planned",
  quoted: "Quoted",
  generating: "Generating…",
  ready: "Ready",
  failed: "Failed",
};

export function VideoProjectDetail({
  project,
  clips,
  assetUrls,
}: {
  project: VideoProject;
  clips: VideoClip[];
  assetUrls: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, startT] = useTransition();
  const [polling, setPolling] = useState(project.status === "generating");

  // Poll the status endpoint while generating; it advances the runner and we
  // refresh when state changes or it completes.
  useEffect(() => {
    if (project.status !== "generating") {
      setPolling(false);
      return;
    }
    setPolling(true);
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/video/projects/${project.id}/status`);
        const data = await res.json();
        if (data.status !== "generating" || data.done) {
          clearInterval(iv);
          router.refresh();
        } else {
          router.refresh();
        }
      } catch {
        /* keep polling */
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [project.status, project.id, router]);

  function run(fn: () => Promise<{ success: boolean; error?: string }>, ok: string) {
    startT(async () => {
      const r = await fn();
      if (r.success) {
        toast.success(ok);
        router.refresh();
      } else {
        toast.error(r.error ?? "Failed");
      }
    });
  }

  const v = project.version;
  const assembledUrl = project.assembledOutputAssetId
    ? assetUrls[project.assembledOutputAssetId]
    : null;
  const readyCount = clips.filter((c) => c.status === "ready").length;

  return (
    <div className="p-4 md:p-8 max-w-[1000px] mx-auto">
      <Link href="/video" className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-foreground mb-4">
        <ArrowLeft size={15} /> Video studio
      </Link>

      <header className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-2">
          <Film size={20} className="text-primary-500" />
          <div>
            <h1 className="text-xl md:text-2xl text-gray-1100 dark:text-foreground">{project.title}</h1>
            <p className="text-sm text-text-muted mt-0.5">
              {project.aspectRatio} · {project.targetResolution} · {clips.length} clips
              {project.creditEstimate != null && ` · est. ${project.creditEstimate} cr`}
              {project.creditActual != null && ` · actual ${project.creditActual} cr`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {project.status === "draft" && (
            <>
              <button onClick={() => run(() => regenerateStoryboard(project.id), "Storyboard regenerated")} disabled={pending} className="rounded-full border border-border bg-card px-3 py-2 text-sm disabled:opacity-60">Regenerate</button>
              <button onClick={() => run(() => submitForReview(project.id, v), "Submitted for review")} disabled={pending} className="rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60">Submit for review</button>
            </>
          )}
          {project.status === "in_review" && (
            <>
              <button onClick={() => run(() => requestChanges(project.id, v), "Sent back to draft")} disabled={pending} className="rounded-full border border-border bg-card px-3 py-2 text-sm disabled:opacity-60">Request changes</button>
              <button onClick={() => run(() => approveProject(project.id, v), "Approved")} disabled={pending} className="rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60">Approve</button>
            </>
          )}
          {project.status === "approved" && (
            <button onClick={() => run(() => startGeneration(project.id, v), "Generation started")} disabled={pending} className="rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60">Start generation</button>
          )}
          {project.status === "generation_failed" && (
            <button onClick={() => run(() => retryGeneration(project.id, v), "Retrying")} disabled={pending} className="rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60">Retry</button>
          )}
          {project.status === "assembled" && (
            <button onClick={() => run(() => exportProject(project.id, v), "Exported")} disabled={pending} className="rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60">Export</button>
          )}
        </div>
      </header>

      {project.status === "approved" && (
        <div className="mb-4 rounded-xl bg-blue-500/5 border border-blue-500/20 px-4 py-3 text-sm text-blue-700 dark:text-blue-300">
          Approved. Generation will quote every clip and check your budget before spending any credits.
        </div>
      )}
      {polling && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-primary-500/5 border border-primary-500/20 px-4 py-3 text-sm text-primary-600 dark:text-primary-400">
          <Loader2 size={15} className="animate-spin" /> Generating — {readyCount}/{clips.length} clips ready. This page updates itself.
        </div>
      )}
      {project.lastError && (
        <div className="mb-4 rounded-xl bg-primary-500/5 border border-primary-500/20 px-4 py-3 text-sm text-primary-600">{project.lastError}</div>
      )}

      {assembledUrl && (
        <div className="mb-6 bg-card border border-border rounded-2xl p-3">
          <p className="text-sm font-medium text-foreground mb-2">Assembled video</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={assembledUrl} controls className="w-full rounded-xl max-h-[70vh]" />
        </div>
      )}

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-sm font-medium text-foreground">Storyboard</div>
        <ul>
          {clips.map((c) => (
            <li key={c.id} className="border-b border-border/50 last:border-0 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-text-muted mb-0.5">
                    Clip {c.seq} · {c.mode} · {c.model} · {c.durationS}s
                  </p>
                  <p className="text-sm text-foreground">{c.prompt}</p>
                  {c.lastError && <p className="text-xs text-primary-500 mt-1">{c.lastError}</p>}
                </div>
                <span className="shrink-0 text-xs text-text-muted">{CLIP_STATUS[c.status] ?? c.status}</span>
              </div>
              {c.outputAssetId && assetUrls[c.outputAssetId] && (
                /* eslint-disable-next-line jsx-a11y/media-has-caption */
                <video src={assetUrls[c.outputAssetId]} controls className="mt-2 w-48 rounded-lg" />
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
