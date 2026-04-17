"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { createCampaign } from "@/lib/actions/campaigns";
import { Button } from "@/components/ui/button";

interface AddCampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddCampaignModal({ isOpen, onClose }: AddCampaignModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await createCampaign(formData);
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
            <h2 className="text-lg font-semibold text-foreground">New Campaign</h2>
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
              <label className={fieldLabel}>Campaign name</label>
              <input
                name="name"
                required
                placeholder="e.g. Grand Opening Awareness"
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
                  <option value="facebook">Facebook</option>
                  <option value="google">Google</option>
                  <option value="youtube">YouTube</option>
                </select>
              </div>
              <div>
                <label className={fieldLabel}>Status</label>
                <select name="status" defaultValue="draft" className={fieldInput}>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Start date</label>
                <input type="date" name="startDate" className={fieldInput} />
              </div>
              <div>
                <label className={fieldLabel}>End date</label>
                <input type="date" name="endDate" className={fieldInput} />
              </div>
            </div>

            <div>
              <label className={fieldLabel}>
                Budget &amp; revenue <span className="text-text-muted/50">(optional)</span>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" name="spend" min="0" step="0.01" placeholder="Spend" className={fieldInput} />
                <input type="number" name="revenue" min="0" step="0.01" placeholder="Revenue" className={fieldInput} />
              </div>
            </div>

            <div>
              <label className={fieldLabel}>
                Performance <span className="text-text-muted/50">(optional)</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                <input type="number" name="impressions" min="0" placeholder="Impressions" className={fieldInput} />
                <input type="number" name="clicks" min="0" placeholder="Clicks" className={fieldInput} />
                <input type="number" name="conversions" min="0" placeholder="Conversions" className={fieldInput} />
              </div>
            </div>

            <div>
              <label className={fieldLabel}>
                Notes <span className="text-text-muted/50">(optional)</span>
              </label>
              <textarea
                name="notes"
                rows={2}
                placeholder="Goals, audience, creative notes"
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
                {isPending ? "Saving…" : "Save Campaign"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
