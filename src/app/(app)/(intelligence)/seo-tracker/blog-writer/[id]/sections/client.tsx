"use client";

// Manual blog-authoring "section builder". The AI-only flow (New blog
// post → ideate → generate) still writes the whole post in one shot;
// this is the alternative on-ramp — type a title, write each section
// yourself, and optionally generate any one of them (using the title +
// whatever sibling sections are already drafted as context). "Compile
// draft" folds everything into the normal content blob and hands off to
// the regular editor at /seo-tracker/blog-writer/[id] — after that a
// manual post is indistinguishable from an AI-generated one.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Sparkles, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  updateDraftSections,
  generateDraftSectionAction,
  generateDraftFaqAction,
  compileDraftSections,
} from "@/lib/actions/blog-sections";
import type { BlogPostRecord, DraftSection } from "@/lib/types/blog-posts";

const MAX_BODY_SECTIONS = 8;

function seedSections(): DraftSection[] {
  return [
    { id: crypto.randomUUID(), kind: "intro", heading: "", content: "" },
    { id: crypto.randomUUID(), kind: "body", heading: "", content: "" },
    { id: crypto.randomUUID(), kind: "conclusion", heading: "", content: "" },
  ];
}

function sectionLabel(kind: DraftSection["kind"], bodyIndex: number): string {
  if (kind === "intro") return "Intro";
  if (kind === "conclusion") return "Conclusion";
  return `Section ${bodyIndex}`;
}

export function SectionBuilderClient({
  post,
  tenantSlug,
}: {
  post: BlogPostRecord;
  tenantSlug: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(post.title);
  const [sections, setSections] = useState<DraftSection[]>(
    post.draftSections && post.draftSections.length > 0
      ? post.draftSections
      : seedSections()
  );
  const [faqItems, setFaqItems] = useState(post.faqItems);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [faqGenerating, setFaqGenerating] = useState(false);
  const [isSaving, startSaving] = useTransition();
  const [isCompiling, startCompiling] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bodyCount = useMemo(
    () => sections.filter((s) => s.kind === "body").length,
    [sections]
  );

  // 1-based position among body sections only, keyed by section id — avoids
  // mutating a counter during the render map below.
  const bodyIndexById = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const s of sections) {
      if (s.kind === "body") map.set(s.id, ++n);
    }
    return map;
  }, [sections]);

  const updateSection = (id: string, patch: Partial<DraftSection>) => {
    setSaved(false);
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const addBodySection = () => {
    if (bodyCount >= MAX_BODY_SECTIONS) return;
    setSaved(false);
    setSections((prev) => {
      const conclusionIdx = prev.findIndex((s) => s.kind === "conclusion");
      const newSection: DraftSection = {
        id: crypto.randomUUID(),
        kind: "body",
        heading: "",
        content: "",
      };
      if (conclusionIdx === -1) return [...prev, newSection];
      return [...prev.slice(0, conclusionIdx), newSection, ...prev.slice(conclusionIdx)];
    });
  };

  const removeBodySection = (id: string) => {
    if (bodyCount <= 1) return;
    setSaved(false);
    setSections((prev) => prev.filter((s) => s.id !== id));
  };

  const addFaqRow = () => {
    setSaved(false);
    setFaqItems((prev) => [...prev, { question: "", answer: "" }]);
  };

  const removeFaqRow = (index: number) => {
    setSaved(false);
    setFaqItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateFaqRow = (index: number, patch: Partial<{ question: string; answer: string }>) => {
    setSaved(false);
    setFaqItems((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  const handleSave = () => {
    setError(null);
    startSaving(async () => {
      const res = await updateDraftSections(tenantSlug, post.id, {
        title,
        draftSections: sections,
        faqItems,
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      setSaved(true);
    });
  };

  const handleGenerateSection = (id: string) => {
    setError(null);
    setGeneratingId(id);
    startSaving(async () => {
      // Persist any unsaved edits first so sibling-section context the
      // generator reads reflects what's on screen, not the last save.
      const presave = await updateDraftSections(tenantSlug, post.id, {
        title,
        draftSections: sections,
        faqItems,
      });
      if (!presave.success) {
        setError(presave.error);
        setGeneratingId(null);
        return;
      }
      const res = await generateDraftSectionAction(tenantSlug, post.id, id);
      setGeneratingId(null);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setSections((prev) => prev.map((s) => (s.id === id ? res.section : s)));
      setSaved(true);
    });
  };

  const handleGenerateFaq = () => {
    setError(null);
    setFaqGenerating(true);
    startSaving(async () => {
      const presave = await updateDraftSections(tenantSlug, post.id, {
        title,
        draftSections: sections,
        faqItems,
      });
      if (!presave.success) {
        setError(presave.error);
        setFaqGenerating(false);
        return;
      }
      const res = await generateDraftFaqAction(tenantSlug, post.id);
      setFaqGenerating(false);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setFaqItems(res.faqItems);
      setSaved(true);
    });
  };

  const handleCompile = () => {
    setError(null);
    startCompiling(async () => {
      const presave = await updateDraftSections(tenantSlug, post.id, {
        title,
        draftSections: sections,
        faqItems,
      });
      if (!presave.success) {
        setError(presave.error);
        return;
      }
      const res = await compileDraftSections(tenantSlug, post.id);
      if (!res.success) {
        setError(res.error);
        return;
      }
      router.push(`/seo-tracker/blog-writer/${post.id}`);
    });
  };

  return (
    <div className="max-w-[820px] mx-auto">
      <div className="flex items-center gap-2 mb-5">
        <Link
          href="/seo-tracker/blog-writer"
          className="text-text-muted hover:text-foreground p-1.5 -ml-1.5 rounded-md hover:bg-sidebar"
          aria-label="Back to blog list"
        >
          <ArrowLeft size={18} />
        </Link>
        <Link href="/seo-tracker/blog-writer" className="text-text-muted hover:text-foreground text-sm">
          Blog posts
        </Link>
        <span className="text-text-muted text-sm">/</span>
        <h1 className="text-foreground font-semibold text-lg truncate">Write it myself</h1>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 mb-4">
        <Label htmlFor="sb-title">Title</Label>
        <Input
          id="sb-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setSaved(false);
          }}
          placeholder="What's this post called?"
        />
      </div>

      <div className="space-y-4">
        {sections.map((section) => {
          const isGenerating = generatingId === section.id;
          const label = sectionLabel(section.kind, bodyIndexById.get(section.id) ?? 0);

          return (
            <div key={section.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-foreground font-semibold text-sm">{label}</span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleGenerateSection(section.id)}
                    disabled={isSaving || isCompiling || generatingId !== null}
                  >
                    {isGenerating ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                    {isGenerating ? "Writing…" : "Generate"}
                  </Button>
                  {section.kind === "body" && bodyCount > 1 && (
                    <button
                      type="button"
                      onClick={() => removeBodySection(section.id)}
                      disabled={isSaving || isCompiling}
                      className="text-text-muted hover:text-red-600 p-1.5 rounded-md hover:bg-sidebar"
                      aria-label={`Remove ${label}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              {section.kind === "body" && (
                <Input
                  value={section.heading}
                  onChange={(e) => updateSection(section.id, { heading: e.target.value })}
                  placeholder="Section heading"
                  className="mb-2"
                />
              )}

              <Textarea
                value={section.content}
                onChange={(e) => updateSection(section.id, { content: e.target.value })}
                placeholder={
                  section.kind === "intro"
                    ? "Hook the reader — what will they get from this post?"
                    : section.kind === "conclusion"
                      ? "Wrap it up — what's the one takeaway?"
                      : "Write this section, or generate a first draft above."
                }
                rows={5}
              />
            </div>
          );
        })}

        {bodyCount < MAX_BODY_SECTIONS && (
          <button
            type="button"
            onClick={addBodySection}
            disabled={isSaving || isCompiling}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-dashed border-border text-text-muted hover:text-foreground hover:border-primary-500/40 text-sm"
          >
            <Plus size={14} />
            Add section
          </button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4 mt-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div>
            <span className="text-foreground font-semibold text-sm">FAQ</span>
            <p className="text-[11px] text-text-muted mt-0.5">
              Feeds structured data only — never shown in the article body.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={handleGenerateFaq}
            disabled={isSaving || isCompiling || generatingId !== null}
          >
            {faqGenerating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            {faqGenerating ? "Writing…" : "Generate FAQ"}
          </Button>
        </div>

        {faqItems.length === 0 ? (
          <p className="text-xs text-text-muted">No FAQ items yet.</p>
        ) : (
          <div className="space-y-3">
            {faqItems.map((item, index) => (
              <div key={index} className="rounded-lg border border-border/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <Input
                    value={item.question}
                    onChange={(e) => updateFaqRow(index, { question: e.target.value })}
                    placeholder="Question"
                    className="mb-2"
                  />
                  <button
                    type="button"
                    onClick={() => removeFaqRow(index)}
                    className="text-text-muted hover:text-red-600 p-1.5 rounded-md hover:bg-sidebar shrink-0"
                    aria-label="Remove FAQ item"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <Textarea
                  value={item.answer}
                  onChange={(e) => updateFaqRow(index, { answer: e.target.value })}
                  placeholder="Answer"
                  rows={2}
                />
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={addFaqRow}
          disabled={isSaving || isCompiling}
          className="w-full flex items-center justify-center gap-1.5 py-2 mt-3 rounded-lg border border-dashed border-border text-text-muted hover:text-foreground hover:border-primary-500/40 text-xs"
        >
          <Plus size={12} />
          Add question
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400 mt-3" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3 mt-5 mb-10">
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" onClick={handleSave} disabled={isSaving || isCompiling}>
            {isSaving ? "Saving…" : "Save draft"}
          </Button>
          {saved && <span className="text-xs text-status-green">Saved.</span>}
        </div>
        <Button type="button" onClick={handleCompile} disabled={isSaving || isCompiling} className="w-full sm:w-auto">
          {isCompiling ? "Compiling…" : "Compile draft →"}
        </Button>
      </div>
    </div>
  );
}
