"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { createManualBlogPost } from "@/lib/actions/blog-posts";
import { LENGTH_BANDS, type LengthBand } from "@/lib/blog/word-count";

/**
 * Phase C manual-create flow. All three fields (title, keyword,
 * context) are optional — user must fill at least one. Brand
 * Positioning + Voice always apply regardless.
 */
export function NewBlogPostModal({
  tenantSlug,
  trackedKeywords,
  onClose,
}: {
  tenantSlug: string;
  trackedKeywords: string[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [improveTitle, setImproveTitle] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [extra, setExtra] = useState("");
  const [band, setBand] = useState<LengthBand>("medium");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const bandInfo = LENGTH_BANDS[band];

  const handleGenerate = () => {
    setError(null);
    setWarning(null);
    if (!title.trim() && !keyword.trim() && !extra.trim()) {
      setError(
        "Fill at least one field — a title, a target keyword, or some context."
      );
      return;
    }
    startTransition(async () => {
      const res = await createManualBlogPost(tenantSlug, {
        title: title.trim() || undefined,
        improveTitle: title.trim() ? improveTitle : undefined,
        targetKeyword: keyword.trim() || undefined,
        extraContext: extra.trim() || undefined,
        targetWordCount: bandInfo.target,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      if (res.wordCountWarning || res.scoreWarning) {
        const parts: string[] = [];
        if (res.wordCountWarning) {
          parts.push(
            `Word count ${res.wordCount} vs target ${res.targetWordCount}.`
          );
        }
        if (res.scoreWarning) {
          parts.push(
            `Content score ${res.contentScore ?? "?"}/100 — under the 80 publish bar after 3 refine passes. Open the side panel to see which sub-scores need work.`
          );
        }
        setWarning(parts.join(" "));
        return;
      }
      onClose();
    });
  };

  // Rough cost estimate — generation ($2/M in + $8/M out on gpt-4.1)
  // plus ~2000 input + 100 output tokens per score pass on gpt-4o-mini.
  // Works out to roughly $0.00004 per target word. Display in mills.
  const costEstimate = (bandInfo.target * 0.00004).toFixed(3);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-stretch md:items-center justify-center md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card w-full md:max-w-[620px] md:rounded-2xl border border-border flex flex-col max-h-screen">
        <div className="p-5 border-b border-border/30 flex items-center justify-between">
          <div>
            <h2 className="text-foreground font-semibold">New blog post</h2>
            <p className="text-text-muted text-xs mt-0.5">
              All fields optional. Brand positioning + voice apply every time.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-foreground text-sm"
          >
            Close
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* Title */}
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="np-title">Title (optional)</Label>
              <label
                className={`inline-flex items-center gap-1.5 text-xs ${
                  title.trim() ? "text-text-muted cursor-pointer" : "text-text-muted/40 cursor-not-allowed"
                }`}
              >
                <input
                  type="checkbox"
                  checked={improveTitle}
                  disabled={!title.trim() || isPending}
                  onChange={(e) => setImproveTitle(e.target.checked)}
                  className="accent-primary-500"
                />
                Let AI polish my title
              </label>
            </div>
            <Input
              id="np-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Leave blank to let AI generate one from context."
              disabled={isPending}
            />
            {title.trim() && !improveTitle && (
              <p className="text-xs text-text-muted mt-1.5">
                Title locked — AI will use it verbatim.
              </p>
            )}
          </div>

          {/* Target keyword */}
          <div>
            <Label htmlFor="np-keyword">Target keyword (optional)</Label>
            {trackedKeywords.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1 mb-2">
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
            )}
            <Input
              id="np-keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. event ticketing Lagos — improves the SEO sub-score."
              disabled={isPending}
            />
          </div>

          {/* Context */}
          <div>
            <Label htmlFor="np-extra">Context / angle (optional)</Label>
            <Textarea
              id="np-extra"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder={
                "Anything specific? Your brand positioning + voice are always applied on top of this."
              }
              rows={4}
              disabled={isPending}
            />
          </div>

          {/* Length */}
          <div>
            <Label htmlFor="np-band">Length</Label>
            <select
              id="np-band"
              value={band}
              onChange={(e) => setBand(e.target.value as LengthBand)}
              disabled={isPending}
              className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm text-foreground"
            >
              {(Object.entries(LENGTH_BANDS) as Array<[LengthBand, (typeof LENGTH_BANDS)[LengthBand]]>).map(
                ([key, info]) => (
                  <option key={key} value={key}>
                    {info.label} (~{info.target} words)
                  </option>
                )
              )}
            </select>
            <p className="text-xs text-text-muted mt-1.5">
              Cost estimate: ~${costEstimate} per draft (includes score + up to 3 refines).
            </p>
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}

          {warning && (
            <div className="rounded-lg border border-status-yellow/40 bg-status-yellow/10 p-3 text-sm text-foreground">
              {warning}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border/30 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            {warning ? "Close" : "Cancel"}
          </Button>
          <Button onClick={handleGenerate} disabled={isPending}>
            {isPending ? "Generating..." : "Generate draft"}
          </Button>
        </div>
      </div>
    </div>
  );
}
