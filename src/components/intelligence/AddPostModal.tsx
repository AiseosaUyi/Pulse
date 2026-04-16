"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { submitCompetitorPost } from "@/lib/actions/intelligence";
import type { Competitor } from "@/lib/types/intelligence";

interface AddPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  competitors: Competitor[];
  tenantSlug: string;
}

export function AddPostModal({ isOpen, onClose, competitors, tenantSlug }: AddPostModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (formData: FormData) => {
    setError(null);
    setSuccess(false);

    // Add tenant ID to form data
    formData.set("tenantId", tenantSlug);

    // Add competitor details from selected ID
    const compId = formData.get("competitorId") as string;
    const comp = competitors.find((c) => c.id === compId);
    if (comp) {
      formData.set("competitorName", comp.name);
      formData.set("competitorType", comp.type);
    }

    startTransition(async () => {
      const result = await submitCompetitorPost(formData);
      if (result.success) {
        setSuccess(true);
        setTimeout(() => {
          onClose();
          setSuccess(false);
        }, 1000);
      } else {
        setError(result.error ?? "Something went wrong");
      }
    });
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-sidebar border border-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-border/50">
            <h2 className="text-lg font-semibold text-foreground">Add Competitor Post</h2>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-card-hover transition-colors">
              <X size={18} className="text-text-muted" />
            </button>
          </div>

          {/* Form */}
          <form action={handleSubmit} className="p-5 space-y-4">
            {/* Competitor */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">
                Competitor
              </label>
              <select
                name="competitorId"
                required
                className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-purple"
              >
                <option value="">Select a competitor</option>
                {competitors.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Platform + Content Type */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">
                  Platform
                </label>
                <select
                  name="platform"
                  required
                  className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-purple"
                >
                  <option value="instagram">Instagram</option>
                  <option value="tiktok">TikTok</option>
                  <option value="twitter">Twitter/X</option>
                  <option value="linkedin">LinkedIn</option>
                  <option value="blog">Blog</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">
                  Content Type
                </label>
                <select
                  name="contentType"
                  required
                  className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-purple"
                >
                  <option value="reel">Reel</option>
                  <option value="post">Post</option>
                  <option value="story">Story</option>
                  <option value="video">Video</option>
                  <option value="blog">Blog</option>
                  <option value="thread">Thread</option>
                </select>
              </div>
            </div>

            {/* Post URL */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">
                Post URL <span className="text-text-muted/50">(optional)</span>
              </label>
              <input
                type="url"
                name="postUrl"
                placeholder="https://instagram.com/p/..."
                className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent-purple"
              />
            </div>

            {/* Summary */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">
                Summary
              </label>
              <textarea
                name="summary"
                required
                rows={3}
                placeholder="Describe what the competitor posted and why it caught your attention..."
                className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent-purple resize-none"
              />
            </div>

            {/* Engagement Metrics */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-1.5">
                Engagement <span className="text-text-muted/50">(at least one required)</span>
              </label>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <input type="number" name="views" min="0" placeholder="Views"
                    className="w-full bg-card border border-border rounded-lg px-2.5 py-2 text-sm text-foreground placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent-purple" />
                </div>
                <div>
                  <input type="number" name="likes" min="0" placeholder="Likes"
                    className="w-full bg-card border border-border rounded-lg px-2.5 py-2 text-sm text-foreground placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent-purple" />
                </div>
                <div>
                  <input type="number" name="comments" min="0" placeholder="Comments"
                    className="w-full bg-card border border-border rounded-lg px-2.5 py-2 text-sm text-foreground placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent-purple" />
                </div>
                <div>
                  <input type="number" name="shares" min="0" placeholder="Shares"
                    className="w-full bg-card border border-border rounded-lg px-2.5 py-2 text-sm text-foreground placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent-purple" />
                </div>
              </div>
            </div>

            {/* Error / Success */}
            {error && (
              <p className="text-sm text-status-red">{error}</p>
            )}
            {success && (
              <p className="text-sm text-status-green">Post added successfully!</p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isPending}
              className="w-full py-2.5 rounded-lg text-sm font-semibold text-foreground bg-gradient-to-r from-accent-purple to-accent-pink hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {isPending ? "Adding..." : "Add Competitor Post"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
