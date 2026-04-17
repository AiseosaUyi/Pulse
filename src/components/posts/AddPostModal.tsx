"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { createPost } from "@/lib/actions/posts";
import { Button } from "@/components/ui/button";

interface AddPostModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddPostModal({ isOpen, onClose }: AddPostModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await createPost(formData);
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
            <h2 className="text-lg font-semibold text-foreground">Log Post</h2>
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
              <label className={fieldLabel}>Title</label>
              <input
                name="title"
                required
                placeholder="e.g. Saturday launch party highlights"
                className={fieldInput}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
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
              <div>
                <label className={fieldLabel}>Content type</label>
                <select name="contentType" required defaultValue="" className={fieldInput}>
                  <option value="" disabled>Select type</option>
                  <option value="video">Video</option>
                  <option value="image">Image</option>
                  <option value="carousel">Carousel</option>
                  <option value="text">Text</option>
                </select>
              </div>
            </div>

            <div>
              <label className={fieldLabel}>Posted on</label>
              <input type="date" name="postedAt" required className={fieldInput} />
            </div>

            <div>
              <label className={fieldLabel}>
                Performance <span className="text-text-muted/50">(optional)</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                <input type="number" name="reach" min="0" placeholder="Reach" className={fieldInput} />
                <input type="number" name="likes" min="0" placeholder="Likes" className={fieldInput} />
                <input type="number" name="comments" min="0" placeholder="Comments" className={fieldInput} />
                <input type="number" name="shares" min="0" placeholder="Shares" className={fieldInput} />
                <input type="number" name="saves" min="0" placeholder="Saves" className={fieldInput} />
                <input type="number" name="impressions" min="0" placeholder="Impressions" className={fieldInput} />
              </div>
            </div>

            <div>
              <label className={fieldLabel}>
                Post URL <span className="text-text-muted/50">(optional)</span>
              </label>
              <input
                type="url"
                name="postUrl"
                placeholder="https://instagram.com/p/..."
                className={fieldInput}
              />
            </div>

            <div>
              <label className={fieldLabel}>
                Notes <span className="text-text-muted/50">(optional)</span>
              </label>
              <textarea
                name="notes"
                rows={2}
                placeholder="Anything worth remembering about this post"
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
                {isPending ? "Logging…" : "Log Post"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
