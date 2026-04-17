"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { addManualTrend } from "@/lib/actions/trends";
import type { TrendPlatform } from "@/lib/types/trends";

export function AddTrendModal({
  tenantSlug,
  onClose,
}: {
  tenantSlug: string;
  onClose: () => void;
}) {
  const [platform, setPlatform] = useState<TrendPlatform>("tiktok");
  const [hashtag, setHashtag] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [summary, setSummary] = useState("");
  const [views, setViews] = useState("");
  const [engagementRate, setEngagementRate] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!summary.trim()) {
      setError("Summary is required");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await addManualTrend({
        tenantSlug,
        platform,
        hashtag: hashtag.trim() || undefined,
        externalUrl: externalUrl.trim() || undefined,
        summary: summary.trim(),
        metrics: {
          views: views ? Number(views) : undefined,
          engagementRate: engagementRate ? Number(engagementRate) : undefined,
        },
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      onClose();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-stretch md:items-center justify-center md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card w-full md:max-w-[560px] md:rounded-2xl border border-border flex flex-col max-h-screen">
        <div className="p-5 border-b border-border/30 flex items-center justify-between">
          <h2 className="text-foreground font-semibold">Add a trend</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-foreground text-sm"
          >
            Close
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tr-platform">Platform</Label>
              <select
                id="tr-platform"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as TrendPlatform)}
                disabled={isPending}
                className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm text-foreground"
              >
                <option value="tiktok">TikTok</option>
                <option value="instagram">Instagram</option>
                <option value="twitter">Twitter/X</option>
              </select>
            </div>
            <div>
              <Label htmlFor="tr-hashtag">Hashtag (optional)</Label>
              <Input
                id="tr-hashtag"
                value={hashtag}
                onChange={(e) => setHashtag(e.target.value)}
                placeholder="#lagosnights"
                disabled={isPending}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="tr-url">Post URL (optional)</Label>
            <Input
              id="tr-url"
              type="url"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
              placeholder="https://www.tiktok.com/@user/video/..."
              disabled={isPending}
            />
          </div>

          <div>
            <Label htmlFor="tr-summary">Summary *</Label>
            <Textarea
              id="tr-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What's going viral? 2–3 sentences."
              rows={4}
              disabled={isPending}
            />
            <p className="text-xs text-text-muted mt-1.5">
              The AI uses this + brand voice to judge applicability + suggest an adaptation.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tr-views">Views (optional)</Label>
              <Input
                id="tr-views"
                type="number"
                value={views}
                onChange={(e) => setViews(e.target.value)}
                placeholder="128000"
                disabled={isPending}
              />
            </div>
            <div>
              <Label htmlFor="tr-er">Engagement rate % (optional)</Label>
              <Input
                id="tr-er"
                type="number"
                step="0.1"
                value={engagementRate}
                onChange={(e) => setEngagementRate(e.target.value)}
                placeholder="12.2"
                disabled={isPending}
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="p-5 border-t border-border/30 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Analyzing..." : "Add trend"}
          </Button>
        </div>
      </div>
    </div>
  );
}
