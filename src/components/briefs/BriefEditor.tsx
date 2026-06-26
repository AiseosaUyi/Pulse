"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { saveBriefContent } from "@/lib/actions/briefs";
import { useDialogs } from "@/components/ui/Dialog";
import type { ContentBrief } from "@/lib/types/intelligence";

export function BriefEditor({
  brief,
  tenantSlug,
  onClose,
}: {
  brief: ContentBrief;
  tenantSlug: string;
  onClose: () => void;
}) {
  const dialogs = useDialogs();
  const [title, setTitle] = useState(brief.title);
  const [draftContent, setDraftContent] = useState(brief.draftContent);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const dirty =
    title !== brief.title || draftContent !== brief.draftContent;

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);

    const keyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSave();
    };
    window.addEventListener("keydown", keyDown);

    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("keydown", keyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, title, draftContent]);

  const handleClose = async () => {
    if (dirty) {
      const ok = await dialogs.confirm({
        title: "Discard unsaved changes?",
        subtitle:
          "Your edits to this brief haven't been saved. Closing now will lose them.",
        tone: "warning",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
      });
      if (!ok) return;
    }
    onClose();
  };

  const handleSave = () => {
    if (!dirty || isPending) return;
    setError(null);
    startTransition(async () => {
      const res = await saveBriefContent(brief.id, tenantSlug, {
        title,
        draftContent,
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
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-black/40 flex items-stretch md:items-center justify-center md:p-4"
      onClick={(e) => {
        if (e.target === overlayRef.current) handleClose();
      }}
    >
      <div className="bg-card w-full md:max-w-[720px] md:rounded-2xl border border-border flex flex-col max-h-screen">
        <div className="p-5 border-b border-border/30 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-foreground font-semibold truncate">
              Edit brief
            </h2>
            {dirty && (
              <span
                className="w-2 h-2 rounded-full bg-primary-500 shrink-0"
                aria-label="Unsaved changes"
                title="Unsaved changes"
              />
            )}
          </div>
          <button
            onClick={handleClose}
            className="text-text-muted hover:text-foreground text-sm"
          >
            Close
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <Label htmlFor="brief-title">Title</Label>
            <Input
              id="brief-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isPending}
            />
          </div>

          <div>
            <Label htmlFor="brief-draft">Draft content</Label>
            <Textarea
              id="brief-draft"
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              disabled={isPending}
              rows={12}
              className="font-[family-name:var(--font-sans)]"
            />
            <p className="text-xs text-text-muted mt-1.5">
              {draftContent.length} characters · ⌘+Enter to save
            </p>
          </div>

          {brief.outline.length > 0 && (
            <div>
              <Label>Outline (read-only)</Label>
              <ul className="text-sm text-text-secondary space-y-1 bg-sidebar rounded-lg p-3 border border-border/30">
                {brief.outline.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-primary font-medium">{i + 1}.</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="p-5 border-t border-border/30 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={handleClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={handleSave}
            disabled={!dirty || isPending}
          >
            {isPending ? "Saving..." : "Save Draft"}
          </Button>
        </div>
      </div>
    </div>
  );
}
