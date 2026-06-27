"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveXIntelConfig } from "@/lib/actions/x-intel";
import type { XIntelConfig } from "@/lib/types/x-intel";

interface Props {
  tenantSlug: string;
  initialConfig: XIntelConfig;
}

function parseLines(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
}

export function XListeningEditor({ tenantSlug, initialConfig }: Props) {
  const [enabled, setEnabled] = useState(initialConfig.enabled);
  const [keywords, setKeywords] = useState(initialConfig.keywords.join("\n"));
  const [accounts, setAccounts] = useState(initialConfig.accounts.join("\n"));
  const [minEng, setMinEng] = useState(String(initialConfig.min_engagement));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const keywordCount = parseLines(keywords).length;
  const accountCount = parseLines(accounts).length;

  const handleSave = () => {
    setError(null);
    setSaved(false);
    const parsed = parseInt(minEng, 10);
    if (isNaN(parsed) || parsed < 0) {
      setError("Minimum likes must be a number 0 or higher.");
      return;
    }
    startTransition(async () => {
      const res = await saveXIntelConfig(tenantSlug, {
        keywords: parseLines(keywords),
        accounts: parseLines(accounts),
        min_engagement: parsed,
        enabled,
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
    <div className="space-y-7">
      {/* Enable toggle */}
      <div className="flex items-center justify-between pb-5 border-b border-border">
        <div>
          <p className="text-sm font-medium text-foreground">Enable X listening</p>
          <p className="text-xs text-text-muted mt-0.5">
            Runs 4× per day via Apify — requires{" "}
            <code className="text-xs bg-sidebar px-1 py-0.5 rounded">APIFY_API_TOKEN</code> in env.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((v) => !v)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
            enabled ? "bg-primary-500" : "bg-gray-200 dark:bg-gray-700"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* Keywords */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="x-keywords">Keywords to monitor</Label>
          <span
            className={`text-xs ${keywordCount > 20 ? "text-red-500" : "text-text-muted"}`}
          >
            {keywordCount}/20
          </span>
        </div>
        <Textarea
          id="x-keywords"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          placeholder={
            "events\nnightlife\nconcert\nlive music\nparty\nopen bar\nwedding\nafrobeats"
          }
          rows={8}
          disabled={isPending}
          className="font-mono text-sm"
        />
        <p className="text-xs text-text-muted">
          One keyword or phrase per line. Tweets matching any keyword with at
          least your minimum engagement threshold surface in Intel Feed.
        </p>
      </div>

      {/* Monitored accounts */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="x-accounts">Accounts to monitor</Label>
          <span
            className={`text-xs ${accountCount > 30 ? "text-red-500" : "text-text-muted"}`}
          >
            {accountCount}/30
          </span>
        </div>
        <Textarea
          id="x-accounts"
          value={accounts}
          onChange={(e) => setAccounts(e.target.value)}
          placeholder={
            "lagosnights\nthedotablog\ngruvehq\nnaijapartyking"
          }
          rows={8}
          disabled={isPending}
          className="font-mono text-sm"
        />
        <p className="text-xs text-text-muted">
          One handle per line, no @ needed. Pulse pulls their top-performing
          posts daily and surfaces them as post recommendations.
        </p>
      </div>

      {/* Engagement threshold */}
      <div className="space-y-2 max-w-[200px]">
        <Label htmlFor="x-min-eng">Minimum likes</Label>
        <Input
          id="x-min-eng"
          type="number"
          min={0}
          max={10000}
          value={minEng}
          onChange={(e) => setMinEng(e.target.value)}
          disabled={isPending}
          className="h-10 text-sm"
        />
        <p className="text-xs text-text-muted">
          Only surface tweets at or above this like count. 15 is a good default;
          raise it to 50+ for very active niches.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {keywordCount > 20 && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          Maximum 20 keywords — remove {keywordCount - 20} before saving.
        </p>
      )}

      {accountCount > 30 && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          Maximum 30 accounts — remove {accountCount - 30} before saving.
        </p>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button
          onClick={handleSave}
          disabled={isPending || keywordCount > 20 || accountCount > 30}
        >
          {isPending ? "Saving..." : "Save"}
        </Button>
        {saved && (
          <span className="text-sm text-success-500">Saved</span>
        )}
      </div>
    </div>
  );
}
