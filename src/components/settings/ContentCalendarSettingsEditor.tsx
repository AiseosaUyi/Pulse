"use client";

import { useState, useTransition, type KeyboardEvent } from "react";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/Toaster";
import { saveContentCalendarConfig } from "@/lib/actions/content-calendar-settings";
import type { ContentCalendarConfig } from "@/lib/content-calendar/config";

export function ContentCalendarSettingsEditor({
  tenantSlug,
  initial,
}: {
  tenantSlug: string;
  initial: ContentCalendarConfig;
}) {
  const [niche, setNiche] = useState(initial.niche);
  const [tags, setTags] = useState(initial.interestTags);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();

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
    if (!niche.trim()) {
      toast.error("Niche can't be empty.");
      return;
    }
    startTransition(async () => {
      const res = await saveContentCalendarConfig(tenantSlug, {
        niche: niche.trim(),
        interestTags: tags,
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
        <Label htmlFor="cc-niche">Niche</Label>
        <p className="text-xs text-text-muted mb-1.5">
          What your content is broadly about — steers both trend-sourcing and topic selection.
        </p>
        <Input
          id="cc-niche"
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          placeholder="AI/tech"
        />
      </div>

      <div>
        <Label htmlFor="cc-tags">Interests &amp; people you follow</Label>
        <p className="text-xs text-text-muted mb-1.5">
          Specific topics, sub-niches, or named accounts/creators you actually care about — the
          AI weighs these when picking a topic instead of just grabbing whatever's generically
          trending. Leave empty and it falls back to trend-only selection.
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
                className="inline-flex items-center gap-1 text-xs bg-sidebar border border-border/60 rounded-full pl-2.5 pr-1.5 py-1"
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

      <Button size="sm" onClick={handleSave} disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
