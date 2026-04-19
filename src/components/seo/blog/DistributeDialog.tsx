"use client";

// Slice 3 — Content Machine. Opens from the blog editor header.
// Generates N distribution artifacts in one call, then lets the user
// inline-edit, copy, approve, or dismiss each one.

import { useEffect, useState, useTransition } from "react";
import {
  Copy,
  Loader2,
  RefreshCw,
  Check,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogCloseButton,
  useDialogs,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  multiplyBlogPost,
  updateDistribution,
  deleteDistribution,
} from "@/lib/actions/content-distributions";
import {
  FORMAT_LABELS,
  type ContentDistributionRecord,
  type DistributionFormat,
  type DistributionStatus,
} from "@/lib/types/content-distributions";

const FORMAT_ORDER: DistributionFormat[] = [
  "twitter_thread",
  "linkedin_post",
  "instagram_carousel",
  "tiktok_hook",
  "email",
  "newsletter",
  "reddit_comment",
  "youtube_short",
];

const STATUS_BADGES: Record<DistributionStatus, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "bg-sidebar text-text-muted" },
  approved: { label: "Approved", tone: "bg-status-green/10 text-status-green" },
  scheduled: { label: "Scheduled", tone: "bg-status-yellow/10 text-status-yellow" },
  published: { label: "Published", tone: "bg-primary-500/10 text-primary-500" },
  dismissed: { label: "Dismissed", tone: "bg-sidebar text-text-muted line-through" },
};

export function DistributeDialog({
  open,
  onClose,
  tenantSlug,
  blogPostId,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  tenantSlug: string;
  blogPostId: string;
  initial: ContentDistributionRecord[];
}) {
  const dialogs = useDialogs();
  const [records, setRecords] = useState<ContentDistributionRecord[]>(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [isMultiplying, startMultiply] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    setRecords(initial);
  }, [initial]);

  const sorted = [...records].sort(
    (a, b) => FORMAT_ORDER.indexOf(a.format) - FORMAT_ORDER.indexOf(b.format)
  );

  const approvedCount = records.filter((r) => r.status === "approved").length;

  const handleMultiply = async () => {
    if (records.length > 0) {
      const ok = await dialogs.confirm({
        title: "Re-run content distribution?",
        subtitle:
          "Draft artifacts will be overwritten. Approved, scheduled, and published artifacts are preserved.",
        tone: "warning",
        confirmLabel: "Re-generate drafts",
      });
      if (!ok) return;
    }
    setError(null);
    startMultiply(async () => {
      const res = await multiplyBlogPost(tenantSlug, blogPostId);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setRecords(res.distributions);
      setDrafts({});
    });
  };

  const handleSave = (
    record: ContentDistributionRecord,
    status?: DistributionStatus
  ) => {
    const nextContent = drafts[record.id] ?? record.content;
    const contentChanged = nextContent !== record.content;
    const statusChanged = status != null && status !== record.status;
    if (!contentChanged && !statusChanged) return;
    setSavingId(record.id);
    setError(null);
    (async () => {
      const res = await updateDistribution(tenantSlug, record.id, {
        content: contentChanged ? nextContent : undefined,
        status: statusChanged ? status : undefined,
      });
      setSavingId(null);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setRecords((prev) =>
        prev.map((r) => (r.id === res.record.id ? res.record : r))
      );
      setDrafts((d) => {
        const { [record.id]: _discard, ...rest } = d;
        void _discard;
        return rest;
      });
    })();
  };

  const handleDismiss = async (record: ContentDistributionRecord) => {
    const ok = await dialogs.confirm({
      title: `Dismiss this ${FORMAT_LABELS[record.format]}?`,
      subtitle:
        "The artifact will be removed. Re-run distribution to regenerate it.",
      tone: "destructive",
      confirmLabel: "Dismiss",
    });
    if (!ok) return;
    const res = await deleteDistribution(tenantSlug, record.id);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setRecords((prev) => prev.filter((r) => r.id !== record.id));
  };

  const handleCopy = async (record: ContentDistributionRecord) => {
    const text = drafts[record.id] ?? record.content;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(record.id);
      setTimeout(() => setCopiedId((id) => (id === record.id ? null : id)), 1500);
    } catch {
      setError("Couldn't copy to clipboard.");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} size="lg" locked={isMultiplying}>
      <DialogCloseButton onClose={onClose} />
      <DialogHeader
        title="Distribute this post"
        subtitle="Your AI team wrote a version for every channel. Approve, edit, or copy each one."
        tone="info"
      />
      <DialogBody className="overflow-y-auto">
        {error && (
          <div
            className="rounded-lg border border-status-red/30 bg-status-red/5 px-3 py-2 text-sm text-status-red"
            role="alert"
          >
            {error}
          </div>
        )}

        {records.length === 0 && !isMultiplying && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <Sparkles size={24} className="mx-auto mb-2 text-primary-500" />
            <p className="text-foreground font-semibold">
              Your AI team hasn&apos;t distributed this post yet.
            </p>
            <p className="text-sm text-text-muted mt-1 max-w-[420px] mx-auto">
              Click &ldquo;Generate all formats&rdquo; to turn this blog into 8
              channel-native artifacts — X, LinkedIn, Instagram, TikTok, email,
              newsletter, Reddit, YouTube Shorts.
            </p>
          </div>
        )}

        {isMultiplying && records.length === 0 && (
          <div className="rounded-xl border border-border p-8 text-center">
            <Loader2 size={20} className="mx-auto mb-2 animate-spin text-primary-500" />
            <p className="text-sm text-text-muted">
              Rewriting for 8 channels… usually ~15-30 seconds.
            </p>
          </div>
        )}

        {sorted.length > 0 && (
          <div className="space-y-3">
            {sorted.map((record) => {
              const draftValue = drafts[record.id] ?? record.content;
              const dirty = draftValue !== record.content;
              const badge = STATUS_BADGES[record.status];
              return (
                <div
                  key={record.id}
                  className="rounded-lg border border-border bg-card"
                >
                  <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border/40">
                    <div className="flex items-center gap-2 min-w-0">
                      <h4 className="text-sm font-semibold text-foreground truncate">
                        {FORMAT_LABELS[record.format]}
                      </h4>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${badge.tone}`}
                      >
                        {badge.label}
                      </span>
                      {dirty && (
                        <span className="text-[10px] text-primary-500">
                          · unsaved
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleCopy(record)}
                        className="p-1.5 rounded-md text-text-muted hover:text-foreground hover:bg-sidebar"
                        title="Copy"
                        aria-label="Copy to clipboard"
                      >
                        {copiedId === record.id ? (
                          <Check size={14} className="text-status-green" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDismiss(record)}
                        className="p-1.5 rounded-md text-text-muted hover:text-status-red hover:bg-sidebar"
                        title="Dismiss"
                        aria-label="Dismiss artifact"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="p-3">
                    <Textarea
                      value={draftValue}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [record.id]: e.target.value }))
                      }
                      rows={Math.max(
                        4,
                        Math.min(12, draftValue.split("\n").length + 1)
                      )}
                      className="font-mono text-xs leading-relaxed"
                    />
                    <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
                      <div className="text-[11px] text-text-muted">
                        {draftValue.length} chars ·{" "}
                        {draftValue.trim().split(/\s+/).length} words
                      </div>
                      <div className="flex items-center gap-1.5">
                        {dirty && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSave(record)}
                            disabled={savingId === record.id}
                          >
                            {savingId === record.id ? "Saving…" : "Save edit"}
                          </Button>
                        )}
                        {record.status !== "approved" ? (
                          <Button
                            size="sm"
                            onClick={() => handleSave(record, "approved")}
                            disabled={savingId === record.id}
                          >
                            Approve
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSave(record, "draft")}
                            disabled={savingId === record.id}
                          >
                            Unapprove
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <div className="text-xs text-text-muted mr-auto">
          {records.length > 0 && (
            <>
              {approvedCount} approved · {records.length} total
            </>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Done
        </Button>
        <Button
          size="sm"
          onClick={handleMultiply}
          disabled={isMultiplying}
          className="gap-1.5"
        >
          {isMultiplying ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Generating…
            </>
          ) : records.length === 0 ? (
            <>
              <Sparkles size={14} />
              Generate all formats
            </>
          ) : (
            <>
              <RefreshCw size={14} />
              Re-generate drafts
            </>
          )}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
