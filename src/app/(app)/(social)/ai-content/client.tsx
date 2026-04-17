"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Calendar, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/Badge";
import { scheduleBriefPost } from "@/lib/actions/scheduled-posts";
import type { ContentBrief } from "@/lib/types/intelligence";

interface Props {
  tenantSlug: string;
  briefs: ContentBrief[];
}

export function AIContentClient({ tenantSlug, briefs }: Props) {
  const [scheduling, setScheduling] = useState<ContentBrief | null>(null);

  return (
    <>
      <div className="space-y-4">
        {briefs.map((b) => (
          <div
            key={b.id}
            className="p-4 rounded-lg bg-background border border-border/30 hover:border-border transition-colors"
          >
            <div className="flex items-start justify-between mb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-medium text-primary-500 capitalize">
                  {b.platform}
                </span>
                <span className="text-text-muted text-xs">·</span>
                <span className="text-text-muted text-xs capitalize">
                  {b.contentType}
                </span>
                {b.competitorName && (
                  <>
                    <span className="text-text-muted text-xs">·</span>
                    <span className="text-text-muted text-xs truncate">
                      from {b.competitorName}
                    </span>
                  </>
                )}
              </div>
              <Badge
                variant={b.status === "approved" ? "active" : "opportunity"}
              >
                {b.status}
              </Badge>
            </div>
            <p className="text-foreground text-sm font-medium mb-1">{b.title}</p>
            {b.draftContent && (
              <p className="text-foreground/80 text-sm leading-relaxed line-clamp-3">
                {b.draftContent}
              </p>
            )}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/20 flex-wrap gap-2">
              <div className="flex items-center gap-4 text-xs flex-wrap">
                {b.seoKeywords && b.seoKeywords.length > 0 && (
                  <span className="text-text-muted">
                    Keywords:{" "}
                    <span className="text-text-secondary">
                      {b.seoKeywords.slice(0, 3).join(", ")}
                    </span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/content-briefs"
                  className="px-3 py-1.5 text-xs bg-primary-500/10 text-primary-500 rounded-md hover:bg-primary-500/20 transition-colors font-medium"
                >
                  Edit
                </Link>
                <Button
                  size="sm"
                  onClick={() => setScheduling(b)}
                  disabled={b.status === "published"}
                >
                  <Calendar size={12} />
                  Schedule
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {scheduling && (
        <ScheduleModal
          tenantSlug={tenantSlug}
          brief={scheduling}
          onClose={() => setScheduling(null)}
        />
      )}
    </>
  );
}

function ScheduleModal({
  tenantSlug,
  brief,
  onClose,
}: {
  tenantSlug: string;
  brief: ContentBrief;
  onClose: () => void;
}) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDate = tomorrow.toISOString().slice(0, 10);

  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("10:00");
  const [caption, setCaption] = useState(brief.draftContent ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const scheduledFor = new Date(`${date}T${time}:00`).toISOString();
    startTransition(async () => {
      const res = await scheduleBriefPost(tenantSlug, {
        briefId: brief.id,
        platform: brief.platform,
        contentType: brief.contentType,
        caption,
        bestTime: time,
        scheduledFor,
        status: "scheduled",
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-card rounded-2xl border border-border w-full max-w-lg my-8">
        <div className="flex items-center justify-between p-5 border-b border-border/30">
          <div className="min-w-0 flex-1 mr-3">
            <h2 className="text-foreground font-semibold truncate">
              Schedule: {brief.title}
            </h2>
            <p className="text-text-muted text-xs mt-0.5 capitalize">
              {brief.platform} · {brief.contentType}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-foreground"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sp-date">Date</Label>
              <Input
                id="sp-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div>
              <Label htmlFor="sp-time">Time</Label>
              <Input
                id="sp-time"
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                disabled={isPending}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="sp-caption">Caption</Label>
            <Textarea
              id="sp-caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={6}
              disabled={isPending}
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-border/30">
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? "Scheduling..." : "Schedule post"}
          </Button>
        </div>
      </div>
    </div>
  );
}
