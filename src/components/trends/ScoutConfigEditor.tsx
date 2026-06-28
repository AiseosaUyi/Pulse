"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { updateScoutConfig } from "@/lib/actions/scout-config";

interface Props {
  tenantSlug: string;
  initialInstagramHashtags: string[];
  initialTiktokHashtags: string[];
}

export function ScoutConfigEditor({
  tenantSlug,
  initialInstagramHashtags,
  initialTiktokHashtags,
}: Props) {
  const [igTags, setIgTags] = useState(initialInstagramHashtags.join("\n"));
  const [ttTags, setTtTags] = useState(initialTiktokHashtags.join("\n"));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const parseList = (raw: string): string[] =>
    raw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSave = () => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateScoutConfig(tenantSlug, {
        instagram_hashtags: parseList(igTags),
        tiktok_hashtags: parseList(ttTags),
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="ig-tags">Instagram hashtags (one per line)</Label>
        <Textarea
          id="ig-tags"
          value={igTags}
          onChange={(e) => setIgTags(e.target.value)}
          placeholder={"growthhacks\nfounderlife\nbuildingpublicly"}
          rows={6}
          disabled={isPending}
          className="font-mono text-sm"
        />
        <p className="text-xs text-text-muted mt-1.5">
          Top 5 posts per hashtag every morning. 3–8 hashtags is the sweet spot.
        </p>
      </div>

      <div>
        <Label htmlFor="tt-tags">TikTok hashtags (one per line)</Label>
        <Textarea
          id="tt-tags"
          value={ttTags}
          onChange={(e) => setTtTags(e.target.value)}
          placeholder={"wellnessjourney\npersonalfinance\nproductivitytips"}
          rows={6}
          disabled={isPending}
          className="font-mono text-sm"
        />
        <p className="text-xs text-text-muted mt-1.5">
          Top 5 videos per hashtag every morning, ranked by view count. Same
          cadence as Instagram.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving..." : "Save scout config"}
        </Button>
        {saved && (
          <span className="text-sm text-green-600 dark:text-green-400">
            Saved ✓
          </span>
        )}
      </div>
    </div>
  );
}
