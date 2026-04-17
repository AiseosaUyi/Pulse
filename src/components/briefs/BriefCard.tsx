"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/button";
import { BriefEditor } from "@/components/briefs/BriefEditor";
import { updateBriefStatus, dismissBrief } from "@/lib/actions/briefs";
import type { ContentBrief, ContentBriefStatus } from "@/lib/types/intelligence";

const DISMISS_DELAY_MS = 5000;

function statusBadgeVariant(status: ContentBriefStatus) {
  switch (status) {
    case "draft":
      return "draft_status" as const;
    case "approved":
      return "approved" as const;
    case "published":
      return "published" as const;
    case "dismissed":
      return "dismissed" as const;
  }
}

function statusLabel(status: ContentBriefStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function BriefCard({
  brief,
  tenantSlug,
}: {
  brief: ContentBrief;
  tenantSlug: string;
}) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [pendingDismiss, setPendingDismiss] = useState<{
    reason: string | null;
    deadline: number;
  } | null>(null);
  const [countdown, setCountdown] = useState(0);
  const dismissTimer = useRef<number | null>(null);

  // While a dismiss is pending, tick a countdown and fire the server action on deadline.
  useEffect(() => {
    if (!pendingDismiss) return;
    const tick = () => {
      const remaining = Math.max(0, pendingDismiss.deadline - Date.now());
      setCountdown(Math.ceil(remaining / 1000));
      if (remaining <= 0) {
        dismissTimer.current = null;
        startTransition(async () => {
          const res = await dismissBrief(
            brief.id,
            tenantSlug,
            pendingDismiss.reason ?? undefined
          );
          if (!res.success) alert(res.error);
          setPendingDismiss(null);
        });
        return;
      }
      dismissTimer.current = window.setTimeout(tick, 200);
    };
    tick();
    return () => {
      if (dismissTimer.current) {
        window.clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDismiss, brief.id, tenantSlug]);

  const handleApprove = () => {
    startTransition(async () => {
      const res = await updateBriefStatus(brief.id, tenantSlug, "approved");
      if (!res.success) alert(res.error);
    });
  };

  const handleDismiss = () => {
    const reason = window.prompt(
      "Why are you dismissing this brief? (Optional — helps prompt tuning)"
    );
    if (reason === null) return;
    setPendingDismiss({
      reason: reason.trim() || null,
      deadline: Date.now() + DISMISS_DELAY_MS,
    });
  };

  const handleUndo = () => {
    setPendingDismiss(null);
  };

  // Pending-dismiss rendering: greyed card + undo banner
  if (pendingDismiss) {
    return (
      <div
        className="bg-card rounded-2xl border border-border overflow-hidden opacity-50 relative"
        aria-busy="true"
      >
        <div className="p-5 border-b border-border/30">
          <h3 className="text-foreground font-semibold line-through">
            {brief.title}
          </h3>
        </div>
        <div className="p-4 bg-sidebar flex items-center justify-between gap-3 border-t border-border/30">
          <p className="text-sm text-text-muted">
            Dismissed. Removing in {countdown}s…
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleUndo}
            disabled={isPending}
          >
            Undo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-card rounded-2xl border border-border overflow-hidden">
        <div className="p-5 border-b border-border/30 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 mb-1 flex-wrap">
              <h3 className="text-foreground font-semibold">{brief.title}</h3>
              <Badge variant={statusBadgeVariant(brief.status)}>
                {statusLabel(brief.status)}
              </Badge>
            </div>
            <p className="text-text-muted text-xs">
              {brief.platform.charAt(0).toUpperCase() + brief.platform.slice(1)}
              {" · "}
              {brief.contentType}
              {brief.competitorName && ` · from ${brief.competitorName}`}
              {" · "}
              {new Date(brief.generatedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
              disabled={isPending || brief.status === "dismissed"}
            >
              Edit
            </Button>
            {brief.status === "draft" && (
              <Button
                variant="default"
                size="sm"
                onClick={handleApprove}
                disabled={isPending}
              >
                Approve
              </Button>
            )}
            {brief.status !== "dismissed" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDismiss}
                disabled={isPending}
              >
                Dismiss
              </Button>
            )}
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
              Outline
            </h4>
            <ul className="space-y-1.5">
              {brief.outline.map((item, i) => (
                <li
                  key={i}
                  className="text-sm text-text-secondary flex items-start gap-2"
                >
                  <span className="text-primary-500 text-xs mt-0.5 shrink-0 font-medium">
                    {i + 1}.
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
              Draft
            </h4>
            <div className="bg-sidebar rounded-lg p-4 text-sm leading-relaxed text-foreground/90 border-l-2 border-primary-500/40 whitespace-pre-wrap">
              {brief.draftContent}
            </div>
          </div>

          {brief.seoKeywords && brief.seoKeywords.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
                Target keywords
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {brief.seoKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="px-2 py-0.5 rounded-full bg-primary-50 border border-primary-500/20 text-xs text-primary-500"
                  >
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <BriefEditor
          brief={brief}
          tenantSlug={tenantSlug}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}
