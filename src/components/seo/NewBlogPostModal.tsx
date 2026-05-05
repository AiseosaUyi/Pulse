"use client";

import { useState, useTransition } from "react";
import { Sparkles, ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  generateBlogIdeasAction,
  commitBlogIdea,
} from "@/lib/actions/blog-posts";
import {
  BLOG_TYPES,
  BLOG_TYPE_LABELS,
  BLOG_TYPE_DESCRIPTIONS,
  type BlogType,
  type FeatureAudience,
  type FeatureMeta,
  type GeneratedIdeaRow,
} from "@/lib/ai/blog-ideate";
import { LENGTH_BANDS, type LengthBand } from "@/lib/blog/word-count";

/**
 * 3-step ideation flow modeled after the video-plan generator:
 *   1. Pick blog type
 *      → if feature_announcement, also fill feature meta
 *   2. AI returns 3 candidate ideas (or 1 for feature announcement)
 *   3. User picks one → full post generation runs
 *
 * Brand voice + positioning + competitors + live trend signals all
 * apply automatically inside generateBlogIdeasAction.
 */

type Step = "pick-type" | "ideating" | "review-ideas" | "generating";

export function NewBlogPostModal({
  tenantSlug,
  trackedKeywords,
  onClose,
}: {
  tenantSlug: string;
  trackedKeywords: string[];
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("pick-type");
  const [blogType, setBlogType] = useState<BlogType>("educational");
  const [extra, setExtra] = useState("");
  const [band, setBand] = useState<LengthBand>("medium");

  // Feature-announcement-only fields.
  const [featureName, setFeatureName] = useState("");
  const [featureAbout, setFeatureAbout] = useState("");
  const [featureAudience, setFeatureAudience] =
    useState<FeatureAudience>("both");
  const [featureBenefits, setFeatureBenefits] = useState("");

  const [ideas, setIdeas] = useState<GeneratedIdeaRow[]>([]);
  const [pickedIdeaId, setPickedIdeaId] = useState<string | null>(null);

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const bandInfo = LENGTH_BANDS[band];
  const isFeatureType = blogType === "feature_announcement";

  // Trim against the type description so the title shows context.
  const featureValid =
    isFeatureType
      ? Boolean(
          featureName.trim() &&
            featureAbout.trim() &&
            featureBenefits.trim()
        )
      : true;

  const onIdeate = () => {
    setError(null);
    if (isFeatureType && !featureValid) {
      setError("Fill the feature name, what it does, and the benefits.");
      return;
    }

    const feature: FeatureMeta | undefined = isFeatureType
      ? {
          name: featureName.trim(),
          about: featureAbout.trim(),
          audience: featureAudience,
          benefits: featureBenefits.trim(),
        }
      : undefined;

    setStep("ideating");
    startTransition(async () => {
      const res = await generateBlogIdeasAction(tenantSlug, {
        blogType,
        feature,
        extraContext: extra.trim() || undefined,
      });
      if (!res.success) {
        setError(res.error);
        setStep("pick-type");
        return;
      }
      setIdeas(res.ideas);
      setPickedIdeaId(res.ideas[0]?.id ?? null);
      setStep("review-ideas");
    });
  };

  const onCommit = () => {
    if (!pickedIdeaId) return;
    setError(null);
    setWarning(null);
    setStep("generating");
    startTransition(async () => {
      const res = await commitBlogIdea(tenantSlug, pickedIdeaId, {
        targetWordCount: bandInfo.target,
      });
      if (!res.success) {
        setError(res.error);
        setStep("review-ideas");
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
            `Content score ${res.contentScore ?? "?"}/100 — under the 90 publish bar after 3 refine passes. Open the side panel to see which sub-scores need work.`
          );
        }
        setWarning(parts.join(" "));
        return;
      }
      onClose();
    });
  };

  const costEstimate = (bandInfo.target * 0.00004).toFixed(3);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-stretch md:items-center justify-center md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card w-full md:max-w-[680px] md:rounded-2xl border border-border flex flex-col max-h-screen">
        <div className="p-5 border-b border-border/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {step === "review-ideas" && (
              <button
                type="button"
                onClick={() => setStep("pick-type")}
                disabled={isPending}
                className="text-text-muted hover:text-foreground"
                aria-label="Back"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <div>
              <h2 className="text-foreground font-semibold">New blog post</h2>
              <p className="text-text-muted text-xs mt-0.5">
                {step === "pick-type" &&
                  "Pick a type — we'll suggest topics that fit your brand and current trends."}
                {step === "ideating" &&
                  "Generating ideas from brand voice, positioning, competitors, and trends…"}
                {step === "review-ideas" &&
                  (isFeatureType
                    ? "Here's your draft topic. Review and generate."
                    : "Pick the angle you want to write.")}
                {step === "generating" &&
                  "Drafting + scoring + refining (up to 3 passes)…"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-foreground text-sm"
          >
            Close
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto flex-1">
          {/* ── Step 1: pick type ─────────────────────────── */}
          {step === "pick-type" && (
            <>
              <div>
                <Label>Blog type</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  {BLOG_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setBlogType(t)}
                      disabled={isPending}
                      className={`text-left p-3 rounded-lg border transition-colors ${
                        blogType === t
                          ? "border-primary-500 bg-primary-500/5"
                          : "border-border hover:border-primary-500/40"
                      }`}
                    >
                      <p className="text-foreground text-sm font-medium">
                        {BLOG_TYPE_LABELS[t]}
                      </p>
                      <p className="text-text-muted text-xs mt-1 leading-snug">
                        {BLOG_TYPE_DESCRIPTIONS[t]}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {isFeatureType ? (
                <div className="space-y-4 pt-2 border-t border-border/30">
                  <p className="text-xs text-text-muted">
                    Tell us about the feature — we&rsquo;ll draft one focused
                    announcement instead of brainstorming three options.
                  </p>
                  <div>
                    <Label htmlFor="ft-name">Feature name</Label>
                    <Input
                      id="ft-name"
                      value={featureName}
                      onChange={(e) => setFeatureName(e.target.value)}
                      placeholder="e.g. Smart Splits, Creator Co-pilot"
                      disabled={isPending}
                    />
                  </div>
                  <div>
                    <Label htmlFor="ft-about">What it does</Label>
                    <Textarea
                      id="ft-about"
                      value={featureAbout}
                      onChange={(e) => setFeatureAbout(e.target.value)}
                      placeholder="Plain-English description of the feature."
                      rows={3}
                      disabled={isPending}
                    />
                  </div>
                  <div>
                    <Label>Who benefits</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {(
                        [
                          { v: "creators", l: "Creators" },
                          { v: "users", l: "Users" },
                          { v: "both", l: "Both" },
                        ] as Array<{ v: FeatureAudience; l: string }>
                      ).map(({ v, l }) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setFeatureAudience(v)}
                          disabled={isPending}
                          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                            featureAudience === v
                              ? "bg-primary-500 text-white border-primary-500"
                              : "bg-sidebar border-border text-text-muted hover:border-primary-500/40"
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="ft-benefits">Benefits</Label>
                    <Textarea
                      id="ft-benefits"
                      value={featureBenefits}
                      onChange={(e) => setFeatureBenefits(e.target.value)}
                      placeholder="What changes for the audience? Be concrete."
                      rows={3}
                      disabled={isPending}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <Label htmlFor="np-extra">Extra context (optional)</Label>
                  <Textarea
                    id="np-extra"
                    value={extra}
                    onChange={(e) => setExtra(e.target.value)}
                    placeholder="Anything specific to weave in? Brand voice + positioning are always applied."
                    rows={3}
                    disabled={isPending}
                  />
                </div>
              )}

              {trackedKeywords.length > 0 && !isFeatureType && (
                <p className="text-xs text-text-muted">
                  We&rsquo;ll prioritise SEO gaps from your tracked keywords:{" "}
                  {trackedKeywords.slice(0, 6).join(", ")}
                  {trackedKeywords.length > 6 ? "…" : ""}
                </p>
              )}
            </>
          )}

          {/* ── Step 2: review ideas ──────────────────────── */}
          {step === "review-ideas" && (
            <>
              <div className="space-y-3">
                {ideas.map((idea) => {
                  const picked = pickedIdeaId === idea.id;
                  return (
                    <button
                      key={idea.id}
                      type="button"
                      onClick={() => setPickedIdeaId(idea.id)}
                      disabled={isPending}
                      className={`w-full text-left p-4 rounded-xl border transition-colors ${
                        picked
                          ? "border-primary-500 bg-primary-500/5"
                          : "border-border hover:border-primary-500/40"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div
                          className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                            picked
                              ? "border-primary-500 bg-primary-500 text-white"
                              : "border-border"
                          }`}
                        >
                          {picked && <Check size={10} strokeWidth={3} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-foreground text-sm font-semibold">
                            {idea.title}
                          </p>
                          <p className="text-text-muted text-xs mt-1.5 leading-snug">
                            {idea.premise}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                            <span className="px-2 py-0.5 rounded-full bg-sidebar text-text-muted">
                              kw: {idea.target_keyword}
                            </span>
                            {idea.trending_signal && (
                              <span className="px-2 py-0.5 rounded-full bg-primary-500/10 text-primary-500">
                                trend: {idea.trending_signal}
                              </span>
                            )}
                          </div>
                          {idea.angle && (
                            <p className="text-[11px] text-text-muted mt-2 italic">
                              Angle: {idea.angle}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-border/30">
                <Label htmlFor="np-band">Length</Label>
                <select
                  id="np-band"
                  value={band}
                  onChange={(e) => setBand(e.target.value as LengthBand)}
                  disabled={isPending}
                  className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm text-foreground"
                >
                  {(
                    Object.entries(LENGTH_BANDS) as Array<
                      [LengthBand, (typeof LENGTH_BANDS)[LengthBand]]
                    >
                  ).map(([key, info]) => (
                    <option key={key} value={key}>
                      {info.label} (~{info.target} words)
                    </option>
                  ))}
                </select>
                <p className="text-xs text-text-muted mt-1.5">
                  Cost estimate: ~${costEstimate} per draft (includes score + up to 3 refines).
                </p>
              </div>
            </>
          )}

          {/* ── ideating / generating spinners ────────────── */}
          {(step === "ideating" || step === "generating") && (
            <div className="py-12 flex flex-col items-center text-center">
              <Sparkles
                size={28}
                className="text-primary-500 animate-pulse mb-3"
              />
              <p className="text-foreground font-medium text-sm">
                {step === "ideating"
                  ? "Brainstorming on-brand topics…"
                  : "Drafting + scoring + refining your post…"}
              </p>
              <p className="text-text-muted text-xs mt-1.5 max-w-[320px]">
                {step === "ideating"
                  ? "Pulling brand voice, positioning, competitors, and live trend signals."
                  : "Up to 3 refine passes to hit the publish bar. ~30-60s."}
              </p>
            </div>
          )}

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
          {step === "pick-type" && (
            <Button
              onClick={onIdeate}
              disabled={isPending || (isFeatureType && !featureValid)}
            >
              {isFeatureType ? "Draft this announcement" : "Generate 3 ideas"}
            </Button>
          )}
          {step === "review-ideas" && (
            <Button
              onClick={onCommit}
              disabled={isPending || !pickedIdeaId}
            >
              {isPending ? "Generating..." : "Generate post"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
