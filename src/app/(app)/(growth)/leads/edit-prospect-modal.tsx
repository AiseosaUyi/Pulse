"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  updateProspect,
  markProspectDuplicate,
  unmarkProspectDuplicate,
  lookupProspectHandle,
} from "@/lib/actions/outbound";
import {
  OUTBOUND_PLATFORMS,
  PLATFORM_LABELS,
  PROSPECT_QUALITIES,
  QUALITY_LABELS,
} from "@/lib/types/outbound";
import type { ProspectRecord, OutboundPlatform, ProspectQuality } from "@/lib/types/outbound";

export function EditProspectModal({
  prospect,
  tenantSlug,
  onClose,
  onSaved,
  onPartialUpdate,
}: {
  prospect: ProspectRecord;
  tenantSlug: string;
  onClose: () => void;
  onSaved: (updated: Partial<ProspectRecord>) => void;
  /** Fired by actions that mutate immediately without closing the modal
   * (duplicate linking) — keeps the pipeline list in sync mid-edit. */
  onPartialUpdate?: (updated: Partial<ProspectRecord>) => void;
}) {
  const [handle, setHandle] = useState(prospect.handle);
  const [platform, setPlatform] = useState<OutboundPlatform>(prospect.platform);
  const [displayName, setDisplayName] = useState(prospect.displayName ?? "");
  const [verifiedName, setVerifiedName] = useState(prospect.verifiedName ?? "");
  const [eventTitle, setEventTitle] = useState(prospect.eventTitle ?? "");
  const [category, setCategory] = useState(prospect.category ?? "");
  const [location, setLocation] = useState(prospect.location ?? "");
  const [bio, setBio] = useState(prospect.bio ?? "");
  const [notes, setNotes] = useState(prospect.notes ?? "");
  const [profileUrl, setProfileUrl] = useState(prospect.profileUrl ?? "");
  const [followerCount, setFollowerCount] = useState(
    prospect.followerCount != null ? String(prospect.followerCount) : ""
  );
  const [lastReachoutAt, setLastReachoutAt] = useState(
    prospect.lastReachoutAt ? prospect.lastReachoutAt.slice(0, 10) : ""
  );
  const [quality, setQuality] = useState<ProspectQuality>(prospect.quality);
  const [error, setError] = useState<string | null>(null);
  const [isPending, start] = useTransition();

  // Duplicate linking — separate from the main save flow since it mutates
  // duplicate_of_id + status immediately (mirrors how "Delete" and other
  // destructive-ish actions elsewhere in this panel act on click, not on
  // form submit).
  const [duplicateOfId, setDuplicateOfId] = useState(prospect.duplicateOfId);
  const [duplicateOfHandle, setDuplicateOfHandle] = useState<string | null>(null);
  const [duplicateInput, setDuplicateInput] = useState("");
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [isDuplicatePending, startDuplicate] = useTransition();

  useEffect(() => {
    if (!duplicateOfId) return;
    let cancelled = false;
    lookupProspectHandle(tenantSlug, duplicateOfId).then((res) => {
      if (!cancelled) setDuplicateOfHandle(res.handle);
    });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, duplicateOfId]);

  const handleMarkDuplicate = () => {
    if (!duplicateInput.trim()) return;
    setDuplicateError(null);
    startDuplicate(async () => {
      const res = await markProspectDuplicate(tenantSlug, prospect.id, duplicateInput);
      if (!res.success) {
        setDuplicateError(res.error);
        return;
      }
      setDuplicateOfId(res.duplicateOfId);
      setDuplicateOfHandle(res.duplicateOfHandle);
      setDuplicateInput("");
      onPartialUpdate?.({ duplicateOfId: res.duplicateOfId, status: "dismissed" });
    });
  };

  const handleUnmarkDuplicate = () => {
    setDuplicateError(null);
    startDuplicate(async () => {
      const res = await unmarkProspectDuplicate(tenantSlug, prospect.id);
      if (!res.success) {
        setDuplicateError(res.error);
        return;
      }
      setDuplicateOfId(null);
      setDuplicateOfHandle(null);
      onPartialUpdate?.({ duplicateOfId: null });
    });
  };

  const handleSave = () => {
    if (!handle.trim()) { setError("Handle is required"); return; }
    setError(null);
    start(async () => {
      const patch = {
        handle: handle.trim(),
        platform,
        displayName: displayName || null,
        verifiedName: verifiedName || null,
        eventTitle: eventTitle || null,
        category: category || null,
        location: location || null,
        bio: bio || null,
        notes: notes || null,
        profileUrl: profileUrl || null,
        followerCount: followerCount ? parseInt(followerCount, 10) || null : null,
        lastReachoutAt: lastReachoutAt ? new Date(lastReachoutAt).toISOString() : null,
        quality,
      };
      const res = await updateProspect(tenantSlug, prospect.id, patch);
      if (!res.success) { setError(res.error ?? "Save failed"); return; }
      onSaved(patch);
      onClose();
    });
  };

  if (typeof document === "undefined") return null;

  const modal = (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="Edit prospect"
        className="fixed inset-x-4 top-[10vh] z-50 mx-auto max-w-lg bg-card rounded-2xl border border-border shadow-2xl flex flex-col max-h-[85vh] animate-fade-scale-in"
      >
        <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/60">
          <h2 className="text-sm font-semibold text-foreground">Edit prospect</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-sidebar text-text-muted hover:text-foreground" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {error && (
            <p className="text-xs text-status-red bg-status-red/5 border border-status-red/20 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Handle <span className="text-status-red">*</span></label>
              <input
                type="text"
                value={handle}
                onChange={e => setHandle(e.target.value)}
                placeholder="username"
                className="w-full text-sm bg-sidebar border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Platform <span className="text-status-red">*</span></label>
              <select
                value={platform}
                onChange={e => setPlatform(e.target.value as OutboundPlatform)}
                className="w-full text-sm bg-sidebar border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30"
              >
                {OUTBOUND_PLATFORMS.map(p => (
                  <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Organizer / event name"
              className="w-full text-sm bg-sidebar border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Verified / account name</label>
            <input
              type="text"
              value={verifiedName}
              onChange={e => setVerifiedName(e.target.value)}
              placeholder="Real name on verified badge"
              className="w-full text-sm bg-sidebar border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Event title</label>
            <input
              type="text"
              value={eventTitle}
              onChange={e => setEventTitle(e.target.value)}
              placeholder="Specific event name for personalised DMs"
              className="w-full text-sm bg-sidebar border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Category</label>
              <input
                type="text"
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="e.g. Food festival"
                className="w-full text-sm bg-sidebar border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Location</label>
              <input
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="e.g. Lagos"
                className="w-full text-sm bg-sidebar border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Lead quality</label>
            <select
              value={quality}
              onChange={e => setQuality(e.target.value as ProspectQuality)}
              className="w-full text-sm bg-sidebar border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30"
            >
              {PROSPECT_QUALITIES.map(q => (
                <option key={q} value={q}>{QUALITY_LABELS[q]}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5 rounded-lg border border-border/60 p-3">
            <label className="text-xs font-medium text-foreground">Duplicate of</label>
            {duplicateOfId ? (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                  <LinkIcon size={11} />
                  Linked to {duplicateOfHandle ? `@${duplicateOfHandle}` : "another prospect"}
                </span>
                <button
                  type="button"
                  onClick={handleUnmarkDuplicate}
                  disabled={isDuplicatePending}
                  className="text-xs text-primary-500 hover:text-primary-600 disabled:opacity-50"
                >
                  {isDuplicatePending ? "Unlinking…" : "Unlink"}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={duplicateInput}
                  onChange={e => setDuplicateInput(e.target.value)}
                  placeholder="@handle of the original prospect"
                  className="flex-1 text-sm bg-sidebar border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleMarkDuplicate}
                  disabled={isDuplicatePending || !duplicateInput.trim()}
                >
                  {isDuplicatePending ? "Linking…" : "Mark"}
                </Button>
              </div>
            )}
            {duplicateError && (
              <p className="text-xs text-status-red">{duplicateError}</p>
            )}
            <p className="text-[11px] text-text-muted">
              Marking as a duplicate links it to the original and moves it to Dismissed — it&rsquo;s never deleted.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Last reachout date</label>
            <input
              type="date"
              value={lastReachoutAt}
              onChange={e => setLastReachoutAt(e.target.value)}
              className="w-full text-sm bg-sidebar border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Profile URL</label>
            <input
              type="url"
              value={profileUrl}
              onChange={e => setProfileUrl(e.target.value)}
              placeholder="https://instagram.com/..."
              className="w-full text-sm bg-sidebar border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Follower count</label>
            <input
              type="number"
              value={followerCount}
              onChange={e => setFollowerCount(e.target.value)}
              placeholder="e.g. 45000"
              className="w-full text-sm bg-sidebar border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Bio</label>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              rows={2}
              placeholder="Short bio or description"
              className="w-full text-sm bg-sidebar border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30 resize-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Internal notes about this prospect"
              className="w-full text-sm bg-sidebar border border-border rounded-lg px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary-500/30 resize-none"
            />
          </div>
        </div>

        <div className="shrink-0 flex justify-end gap-2 px-5 py-4 border-t border-border/60">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={isPending} className="gap-1.5">
            {isPending && <Loader2 size={12} className="animate-spin" />}
            Save changes
          </Button>
        </div>
      </div>
    </>
  );

  return createPortal(modal, document.body);
}
