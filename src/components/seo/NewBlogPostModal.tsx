"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { generateBlogPostDraft } from "@/lib/actions/blog-posts";

export function NewBlogPostModal({
  tenantSlug,
  trackedKeywords,
  onClose,
}: {
  tenantSlug: string;
  trackedKeywords: string[];
  onClose: () => void;
}) {
  const [keyword, setKeyword] = useState(trackedKeywords[0] ?? "");
  const [extra, setExtra] = useState("");
  const [wordCount, setWordCount] = useState("1200");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = () => {
    if (!keyword.trim()) {
      setError("Target keyword is required");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await generateBlogPostDraft(tenantSlug, {
        targetKeyword: keyword.trim(),
        extraContext: extra.trim() || undefined,
        targetWordCount: Number(wordCount) || 1200,
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
          <h2 className="text-foreground font-semibold">New blog post</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-foreground text-sm"
          >
            Close
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <Label htmlFor="np-keyword">Target keyword</Label>
            {trackedKeywords.length > 0 ? (
              <div className="flex flex-wrap gap-2 mb-2">
                {trackedKeywords.slice(0, 10).map((kw) => (
                  <button
                    key={kw}
                    type="button"
                    onClick={() => setKeyword(kw)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      keyword === kw
                        ? "bg-primary-500 text-white border-primary-500"
                        : "bg-sidebar border-border text-text-muted hover:border-primary-500/40"
                    }`}
                  >
                    {kw}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted mb-2">
                You have no tracked keywords yet. Type one below, or add some
                at /seo-tracker/keywords.
              </p>
            )}
            <Input
              id="np-keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. event ticketing Lagos"
              disabled={isPending}
            />
          </div>

          <div>
            <Label htmlFor="np-extra">Context / angle (optional)</Label>
            <Textarea
              id="np-extra"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder={
                "What should this post cover or argue? e.g. 'Compare us vs Nairabox / Tix Africa without naming them. Lean into Lagos-specific pain points.'"
              }
              rows={4}
              disabled={isPending}
            />
          </div>

          <div>
            <Label htmlFor="np-words">Target word count</Label>
            <select
              id="np-words"
              value={wordCount}
              onChange={(e) => setWordCount(e.target.value)}
              disabled={isPending}
              className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm text-foreground"
            >
              <option value="800">~800 words (short)</option>
              <option value="1200">~1200 words (standard)</option>
              <option value="2000">~2000 words (long-form)</option>
              <option value="3000">~3000 words (pillar)</option>
            </select>
            <p className="text-xs text-text-muted mt-1.5">
              Cost estimate: ~${(Number(wordCount) * 0.00004).toFixed(3)} per
              draft.
            </p>
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
          <Button onClick={handleGenerate} disabled={isPending}>
            {isPending ? "Generating..." : "Generate draft"}
          </Button>
        </div>
      </div>
    </div>
  );
}
