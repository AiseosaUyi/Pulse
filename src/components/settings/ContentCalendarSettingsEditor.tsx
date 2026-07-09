"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/Toaster";
import { saveContentCalendarConfig } from "@/lib/actions/content-calendar-settings";
import type { ContentCalendarConfig } from "@/lib/content-calendar/config";

// Deliberately broad, not tech-specific — this settings page can't assume
// the tenant's niche. For someone who genuinely doesn't know what to put
// here yet (senior-uiux audit stage 00), clicking a starting point beats
// typing an example answer from a blank box.
const EXAMPLE_PILLARS = [
  "AI tools",
  "Startups & business",
  "Personal finance",
  "Fitness & health",
  "Productivity",
  "Marketing & growth",
  "Career advice",
  "Tech news",
];

export function ContentCalendarSettingsEditor({
  tenantSlug,
  initial,
}: {
  tenantSlug: string;
  initial: ContentCalendarConfig;
}) {
  const [niches, setNiches] = useState(initial.niches);
  const [nicheDraft, setNicheDraft] = useState("");
  const [tags, setTags] = useState(initial.interestTags);
  const [draft, setDraft] = useState("");
  const [postsPerDay, setPostsPerDay] = useState(initial.postsPerDay);
  const [pending, startTransition] = useTransition();

  const addNiche = (value: string = nicheDraft) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (niches.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      setNicheDraft("");
      return;
    }
    setNiches((prev) => [...prev, trimmed]);
    setNicheDraft("");
  };

  const removeNiche = (value: string) => {
    setNiches((prev) => prev.filter((n) => n !== value));
  };

  const handleNicheKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addNiche();
    }
  };

  const addTag = () => {
    const value = draft.trim();
    if (!value) return;
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    setTags((prev) => [...prev, value]);
    setDraft("");
  };

  const removeTag = (value: string) => {
    setTags((prev) => prev.filter((t) => t !== value));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    }
  };

  const handleSave = () => {
    if (niches.length === 0) {
      toast.error("Add at least one content pillar.");
      return;
    }
    startTransition(async () => {
      const res = await saveContentCalendarConfig(tenantSlug, {
        niches,
        interestTags: tags,
        postsPerDay,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Saved. Your next “Generate” will use this.");
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="cc-niche">Content pillars</Label>
        <p className="text-xs text-text-muted mb-1.5">
          The categories you rotate through — e.g. &ldquo;AI tools&rdquo;, &ldquo;AI in design&rdquo;, &ldquo;startups&rdquo;. The AI spreads each batch across all of them.
        </p>
        <div className="flex gap-2 mb-2">
          <Input
            id="cc-niche"
            value={nicheDraft}
            onChange={(e) => setNicheDraft(e.target.value)}
            onKeyDown={handleNicheKeyDown}
            placeholder="e.g. AI tools"
          />
          <Button type="button" size="sm" variant="tertiary" onClick={() => addNiche()} className="gap-1 shrink-0">
            <Plus size={14} /> Add
          </Button>
        </div>
        {niches.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {niches.map((n) => (
              <span
                key={n}
                className="inline-flex items-center gap-1 text-xs text-foreground bg-gray-100 border border-border rounded-full pl-2.5 pr-1.5 py-1"
              >
                {n}
                <button
                  type="button"
                  onClick={() => removeNiche(n)}
                  className="text-text-muted hover:text-status-red"
                  aria-label={`Remove ${n}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {(() => {
          const suggestions = EXAMPLE_PILLARS.filter(
            (ex) => !niches.some((n) => n.toLowerCase() === ex.toLowerCase())
          );
          if (suggestions.length === 0) return null;
          return (
            <div>
              <p className="text-[11px] text-text-muted mb-1">
                Not sure yet? Start with one of these:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => addNiche(ex)}
                    className="inline-flex items-center gap-1 text-xs text-text-muted bg-transparent border border-dashed border-border rounded-full pl-2.5 pr-2 py-1 hover:text-primary-500 hover:border-primary-500 transition-colors"
                  >
                    <Plus size={11} /> {ex}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
      </div>

      <div>
        <Label htmlFor="cc-tags">Interests &amp; people you follow</Label>
        <p className="text-xs text-text-muted mb-1.5">
          Specific topics or people you follow — the AI weighs these over generic trends. Not sure? Leave it empty, trends alone work fine.
        </p>
        <div className="flex gap-2 mb-2">
          <Input
            id="cc-tags"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Perplexity, agentic coding, @swyx"
          />
          <Button type="button" size="sm" variant="tertiary" onClick={addTag} className="gap-1 shrink-0">
            <Plus size={14} /> Add
          </Button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 text-xs text-foreground bg-gray-100 border border-border rounded-full pl-2.5 pr-1.5 py-1"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="text-text-muted hover:text-status-red"
                  aria-label={`Remove ${tag}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="cc-posts-per-day">Posts per day</Label>
        <p className="text-xs text-text-muted mb-1.5">
          How many slots a fresh batch packs onto each day before moving to the next. Most days are one; bump it up for days you know you&apos;ll film more than once.
        </p>
        <select
          id="cc-posts-per-day"
          value={postsPerDay}
          onChange={(e) => setPostsPerDay(Number(e.target.value))}
          className="h-9 rounded-lg border border-border bg-transparent px-2 text-sm text-foreground"
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? "post" : "posts"}/day
            </option>
          ))}
        </select>
      </div>

      <Button size="sm" onClick={handleSave} disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
