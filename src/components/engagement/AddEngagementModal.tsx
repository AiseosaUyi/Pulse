"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { createEngagementItem } from "@/lib/actions/engagement";
import { Button } from "@/components/ui/button";

interface AddEngagementModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddEngagementModal({ isOpen, onClose }: AddEngagementModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await createEngagementItem(formData);
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
            <h2 className="text-lg font-semibold text-foreground">Log Message</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-card-hover transition-colors"
              aria-label="Close"
            >
              <X size={18} className="text-text-muted" />
            </button>
          </div>

          <form action={handleSubmit} className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Type</label>
                <select name="type" required defaultValue="" className={fieldInput}>
                  <option value="" disabled>Select type</option>
                  <option value="dm">DM</option>
                  <option value="comment">Comment</option>
                  <option value="mention">Mention</option>
                  <option value="reply">Reply</option>
                </select>
              </div>
              <div>
                <label className={fieldLabel}>Platform</label>
                <select name="platform" required defaultValue="" className={fieldInput}>
                  <option value="" disabled>Select platform</option>
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="twitter">Twitter/X</option>
                  <option value="linkedin">LinkedIn</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Sender name</label>
                <input name="fromName" required placeholder="e.g. Tolu Adeyemi" className={fieldInput} />
              </div>
              <div>
                <label className={fieldLabel}>
                  Handle <span className="text-text-muted/50">(optional)</span>
                </label>
                <input name="fromHandle" placeholder="@handle" className={fieldInput} />
              </div>
            </div>

            <div>
              <label className={fieldLabel}>Message</label>
              <textarea
                name="content"
                required
                rows={3}
                placeholder="What did they say?"
                className={`${fieldInput} resize-none`}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Sentiment</label>
                <select name="sentiment" defaultValue="neutral" className={fieldInput}>
                  <option value="positive">Positive</option>
                  <option value="neutral">Neutral</option>
                  <option value="negative">Negative</option>
                  <option value="question">Question</option>
                </select>
              </div>
              <div>
                <label className={fieldLabel}>
                  Avatar emoji <span className="text-text-muted/50">(optional)</span>
                </label>
                <input name="fromAvatar" placeholder="🎧" maxLength={4} className={fieldInput} />
              </div>
            </div>

            <div>
              <label className={fieldLabel}>
                On post <span className="text-text-muted/50">(optional, for comments)</span>
              </label>
              <input
                name="postTitle"
                placeholder="Post title this refers to"
                className={fieldInput}
              />
            </div>

            <div>
              <label className={fieldLabel}>
                Link to original <span className="text-text-muted/50">(optional)</span>
              </label>
              <input
                type="url"
                name="externalUrl"
                placeholder="https://instagram.com/p/..."
                className={fieldInput}
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
                {isPending ? "Logging…" : "Log Message"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
