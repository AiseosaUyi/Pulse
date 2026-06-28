"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { brandVoiceSchema } from "@/lib/ai/brand-voice";
import { updateBrandVoice } from "@/lib/actions/briefs";
import { inferBrandVoiceFromPosts } from "@/lib/actions/infer-brand-voice";
import type { z } from "zod";

type BrandVoice = z.infer<typeof brandVoiceSchema>;

interface Props {
  tenantSlug: string;
  initial: BrandVoice | null;
  publishedPostCount?: number;
}

export function BrandVoiceEditor({ tenantSlug, initial, publishedPostCount = 0 }: Props) {
  const [tone, setTone] = useState(initial?.tone ?? "");
  const [audience, setAudience] = useState(initial?.audience ?? "");
  const [doList, setDoList] = useState((initial?.do_list ?? [""]).join("\n"));
  const [dontList, setDontList] = useState(
    (initial?.dont_list ?? [""]).join("\n")
  );
  const [examplePosts, setExamplePosts] = useState(
    (initial?.example_posts ?? [""]).join("\n\n---\n\n")
  );
  const [isPending, startTransition] = useTransition();
  const [isInferring, startInferTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const canInfer = publishedPostCount >= 3;

  const handleInfer = () => {
    setError(null);
    startInferTransition(async () => {
      const res = await inferBrandVoiceFromPosts();
      if (!res.success) {
        setError(res.error);
        return;
      }
      const v = res.voice;
      setTone(v.tone);
      setAudience(v.audience);
      setDoList(v.do_list.join("\n"));
      setDontList(v.dont_list.join("\n"));
      setExamplePosts(v.example_posts.join("\n\n---\n\n"));
      setSaved(false);
    });
  };

  const handleSave = () => {
    setError(null);
    setSaved(false);
    const payload = {
      tone: tone.trim(),
      audience: audience.trim(),
      do_list: doList
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      dont_list: dontList
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      example_posts: examplePosts
        .split(/\n\s*---\s*\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const parsed = brandVoiceSchema.safeParse(payload);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((i) => i.message).join(" · ") ||
          "Validation failed"
      );
      return;
    }
    startTransition(async () => {
      const res = await updateBrandVoice(tenantSlug, parsed.data);
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
      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <Label htmlFor="bv-tone">Tone</Label>
          <Input
            id="bv-tone"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            placeholder="e.g. Warm, direct, conversational"
            disabled={isPending}
          />
        </div>
        <div>
          <Label htmlFor="bv-audience">Audience</Label>
          <Input
            id="bv-audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="e.g. 25-40, early-stage founders, LinkedIn-heavy"
            disabled={isPending}
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        <div>
          <Label htmlFor="bv-do">Do (one per line)</Label>
          <Textarea
            id="bv-do"
            value={doList}
            onChange={(e) => setDoList(e.target.value)}
            placeholder={"Lead with the outcome, not the feature\nUse real customer language"}
            rows={5}
            disabled={isPending}
          />
        </div>
        <div>
          <Label htmlFor="bv-dont">Don&apos;t (one per line)</Label>
          <Textarea
            id="bv-dont"
            value={dontList}
            onChange={(e) => setDontList(e.target.value)}
            placeholder={"Never sound corporate\nNo emoji-heavy headlines"}
            rows={5}
            disabled={isPending}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="bv-examples">
          Example posts (separate with a line containing only ---)
        </Label>
        <Textarea
          id="bv-examples"
          value={examplePosts}
          onChange={(e) => setExamplePosts(e.target.value)}
          placeholder={`Sunset hits different at 2,000ft. Find us tonight.\n\n---\n\nWhen the DJ drops at 2am and you forget your own name 🔥`}
          rows={10}
          disabled={isPending}
        />
        <p className="text-xs text-text-muted mt-1.5">
          2–3 actual published captions work best. These ground the AI in
          your real voice.
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-border">
        <Button onClick={handleSave} disabled={isPending || isInferring}>
          {isPending ? "Saving..." : "Save brand voice"}
        </Button>
        <Button
          variant="outline"
          onClick={handleInfer}
          disabled={isInferring || isPending || !canInfer}
          title={!canInfer ? `Need at least 3 published blog posts (you have ${publishedPostCount})` : "Infer brand voice from your published posts"}
        >
          {isInferring ? "Analysing posts…" : "Infer from posts"}
        </Button>
        {!canInfer && (
          <span className="text-xs text-text-muted">
            Publish at least 3 blog posts to enable this
          </span>
        )}
        {saved && (
          <span className="text-sm text-green-600 dark:text-green-400">
            Saved ✓
          </span>
        )}
      </div>
    </div>
  );
}
