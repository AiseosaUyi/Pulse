"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { updateScoutConfig } from "@/lib/actions/scout-config";

interface Props {
  tenantSlug: string;
  initialHashtags: string[];
  initialRegion: string;
}

export function ScoutConfigEditor({
  tenantSlug,
  initialHashtags,
  initialRegion,
}: Props) {
  const [hashtags, setHashtags] = useState(initialHashtags.join("\n"));
  const [region, setRegion] = useState(initialRegion);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setError(null);
    setSaved(false);
    const tags = hashtags
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    startTransition(async () => {
      const res = await updateScoutConfig(tenantSlug, {
        instagram_hashtags: tags,
        tiktok_region: region,
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
    <div className="space-y-5">
      <div>
        <Label htmlFor="ig-tags">Instagram hashtags (one per line)</Label>
        <Textarea
          id="ig-tags"
          value={hashtags}
          onChange={(e) => setHashtags(e.target.value)}
          placeholder={"lagosmemes\nlagosnightlife\nnaijahumor"}
          rows={8}
          disabled={isPending}
          className="font-mono text-sm"
        />
        <p className="text-xs text-text-muted mt-1.5">
          The scout pulls top 5 posts per hashtag every morning. Keep to 3–8
          hashtags — more than that dilutes the signal.
        </p>
      </div>

      <div>
        <Label htmlFor="tt-region">TikTok region (ISO country code)</Label>
        <Input
          id="tt-region"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          placeholder="NG"
          maxLength={3}
          disabled={isPending}
          className="max-w-[120px] font-mono"
        />
        <p className="text-xs text-text-muted mt-1.5">
          TikTok Creative Center surfaces trending hashtags by country. NG =
          Nigeria. Leave blank to skip TikTok for this tenant.
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
