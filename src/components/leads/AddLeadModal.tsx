"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { createLead } from "@/lib/actions/leads";
import { Button } from "@/components/ui/button";

interface AddLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddLeadModal({ isOpen, onClose }: AddLeadModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await createLead(formData);
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
            <h2 className="text-lg font-semibold text-foreground">Add Lead</h2>
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
              <input
                name="name"
                required
                placeholder="Contact name"
                className={fieldInput}
              />
            </div>

            <div>
              <label className={fieldLabel}>Company</label>
              <input
                name="company"
                placeholder="Company or organization"
                className={fieldInput}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Type</label>
                <select name="type" required defaultValue="" className={fieldInput}>
                  <option value="" disabled>Select type</option>
                  <option value="venue">Venue</option>
                  <option value="sponsor">Sponsor</option>
                  <option value="partner">Partner</option>
                  <option value="influencer">Influencer</option>
                  <option value="media">Media</option>
                </select>
              </div>
              <div>
                <label className={fieldLabel}>Status</label>
                <select name="status" defaultValue="new" className={fieldInput}>
                  <option value="new">New</option>
                  <option value="contacted">Contacted</option>
                  <option value="warm">Warm</option>
                  <option value="cold">Cold</option>
                  <option value="converted">Converted</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Value</label>
                <select name="value" defaultValue="medium" className={fieldInput}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="very_high">Very High</option>
                </select>
              </div>
              <div>
                <label className={fieldLabel}>Last contact</label>
                <input
                  type="date"
                  name="lastContact"
                  className={fieldInput}
                />
              </div>
            </div>

            <div>
              <label className={fieldLabel}>Next action</label>
              <input
                name="nextAction"
                placeholder="e.g. Send partnership deck"
                className={fieldInput}
              />
            </div>

            <div>
              <label className={fieldLabel}>Notes</label>
              <textarea
                name="notes"
                rows={3}
                placeholder="Anything else to remember"
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
                {isPending ? "Adding…" : "Add Lead"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
