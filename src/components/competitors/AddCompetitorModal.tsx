"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { createCompetitor } from "@/lib/actions/competitors";
import { Button } from "@/components/ui/button";

interface AddCompetitorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddCompetitorModal({ isOpen, onClose }: AddCompetitorModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await createCompetitor(formData);
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
            <h2 className="text-lg font-semibold text-foreground">Add Competitor</h2>
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
              <label className={fieldLabel}>Name</label>
              <input name="name" required placeholder="e.g. Tix Africa" className={fieldInput} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Website</label>
                <input name="website" placeholder="tix.africa" className={fieldInput} />
              </div>
              <div>
                <label className={fieldLabel}>Type</label>
                <select name="type" required defaultValue="" className={fieldInput}>
                  <option value="" disabled>Select type</option>
                  <option value="direct">Direct</option>
                  <option value="aspirational">Aspirational</option>
                  <option value="adjacent">Adjacent</option>
                </select>
              </div>
            </div>

            <div>
              <label className={fieldLabel}>Threat level</label>
              <select name="threatLevel" defaultValue="medium" className={fieldInput}>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label className={fieldLabel}>
                Social presence <span className="text-text-muted/50">(optional)</span>
              </label>
              <div className="space-y-2">
                {(["instagram", "tiktok", "twitter", "linkedin", "blog"] as const).map((p) => (
                  <div key={p} className="grid grid-cols-[80px_1fr_120px] gap-2 items-center">
                    <span className="text-xs text-text-muted capitalize">{p}</span>
                    <input
                      name={`${p}_handle`}
                      placeholder={`@handle or URL`}
                      className={fieldInput}
                    />
                    <input
                      type="number"
                      min="0"
                      name={`${p}_followers`}
                      placeholder="Followers"
                      className={fieldInput}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className={fieldLabel}>
                Strengths <span className="text-text-muted/50">(one per line)</span>
              </label>
              <textarea
                name="strengths"
                rows={3}
                placeholder="Established brand&#10;Multi-city presence"
                className={`${fieldInput} resize-none`}
              />
            </div>

            <div>
              <label className={fieldLabel}>
                Weaknesses <span className="text-text-muted/50">(one per line)</span>
              </label>
              <textarea
                name="weaknesses"
                rows={3}
                placeholder="Generic positioning&#10;Low social engagement"
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
                {isPending ? "Saving…" : "Add Competitor"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
