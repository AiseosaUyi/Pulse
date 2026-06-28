"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { createKeywordRanking } from "@/lib/actions/keywords";
import { Button } from "@/components/ui/button";

interface AddKeywordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddKeywordModal({ isOpen, onClose }: AddKeywordModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await createKeywordRanking(formData);
      if (result.success) {
        onClose();
      } else {
        setError(result.error ?? "Something went wrong");
      }
    });
  };

  const fieldLabel = "block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5";
  const fieldInput = "w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-blue-500/30";

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />

      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="bg-card border border-border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between p-5 border-b border-border/50">
            <h2 className="text-lg font-semibold text-foreground">Track Keyword</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-card-hover transition-colors"
              aria-label="Close"
            >
              <X size={18} className="text-text-muted" />
            </button>
          </div>

          <form action={handleSubmit} className="p-5 space-y-4">
            <div>
              <label className={fieldLabel}>Keyword</label>
              <input
                name="keyword"
                required
                placeholder="e.g. project management for remote teams"
                className={fieldInput}
              />
            </div>

            <div>
              <label className={fieldLabel}>
                Target URL <span className="text-text-muted/50">(optional)</span>
              </label>
              <input name="url" placeholder="/events or https://..." className={fieldInput} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Current position</label>
                <input
                  type="number"
                  name="position"
                  min="1"
                  placeholder="e.g. 11"
                  className={fieldInput}
                />
              </div>
              <div>
                <label className={fieldLabel}>Previous position</label>
                <input
                  type="number"
                  name="previousPosition"
                  min="1"
                  placeholder="e.g. 15"
                  className={fieldInput}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Monthly volume</label>
                <input
                  type="number"
                  name="volume"
                  min="0"
                  placeholder="e.g. 2400"
                  className={fieldInput}
                />
              </div>
              <div>
                <label className={fieldLabel}>Difficulty</label>
                <select name="difficulty" defaultValue="medium" className={fieldInput}>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </div>
            </div>

            <div>
              <label className={fieldLabel}>
                Last checked <span className="text-text-muted/50">(optional)</span>
              </label>
              <input type="date" name="lastChecked" className={fieldInput} />
            </div>

            <div>
              <label className={fieldLabel}>
                Notes <span className="text-text-muted/50">(optional)</span>
              </label>
              <textarea
                name="notes"
                rows={2}
                placeholder="Why this keyword matters"
                className={`${fieldInput} resize-none`}
              />
            </div>

            {error && <p className="text-sm text-status-red">{error}</p>}

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="tertiary"
                size="sm"
                onClick={onClose}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "Saving…" : "Track Keyword"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
