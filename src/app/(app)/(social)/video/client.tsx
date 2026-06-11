"use client";

import Link from "next/link";
import { Film, Users, ArrowUpRight } from "lucide-react";
import type { VideoProject } from "@/lib/types/video";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  generating: "Generating…",
  assembled: "Ready",
  exported: "Exported",
  generation_failed: "Failed",
  archived: "Archived",
};

const STATUS_CLASS: Record<string, string> = {
  draft: "bg-gray-500/10 text-text-muted",
  in_review: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  approved: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  generating: "bg-primary-500/10 text-primary-500",
  assembled: "bg-green-500/10 text-green-600 dark:text-green-400",
  exported: "bg-green-500/10 text-green-600 dark:text-green-400",
  generation_failed: "bg-primary-500/10 text-primary-500",
  archived: "bg-gray-500/10 text-text-muted",
};

export function VideoProjectsClient({ projects }: { projects: VideoProject[] }) {
  return (
    <div className="p-4 md:p-8 max-w-[1100px] mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Film size={20} className="text-primary-500" />
          <div>
            <h1 className="text-xl md:text-2xl text-gray-1100 dark:text-foreground">
              Video studio
            </h1>
            <p className="text-sm text-text-muted mt-0.5">
              Turn approved content into short-form video. Create one from an
              approved content plan, then review, approve, and generate.
            </p>
          </div>
        </div>
        <Link
          href="/video/characters"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-sidebar"
        >
          <Users size={15} /> Characters
        </Link>
      </header>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {projects.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-12">
            No video projects yet. Open an approved content plan in{" "}
            <Link href="/ai-content?tab=video" className="text-primary-500">
              AI Content
            </Link>{" "}
            and choose “Create video.”
          </p>
        ) : (
          <ul>
            {projects.map((p) => (
              <li key={p.id} className="border-b border-border/50 last:border-0">
                <Link
                  href={`/video/${p.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-sidebar transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {p.title}
                    </p>
                    <p className="text-xs text-text-muted mt-0.5">
                      {p.aspectRatio} · {p.targetResolution}
                      {p.creditEstimate != null && ` · ~${p.creditEstimate} cr`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_CLASS[p.status] ?? "bg-gray-500/10 text-text-muted"
                      }`}
                    >
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                    <ArrowUpRight size={14} className="text-text-muted" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
