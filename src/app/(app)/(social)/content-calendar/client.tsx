"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  ChevronRight,
  Loader2,
  RefreshCw,
  Upload,
  Check,
  X,
  AlertTriangle,
  Link as LinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/Toaster";
import {
  generateNextBatch,
  regenerateSlot,
  updateSlotStatus,
  updateSlotNotes,
  markSlotOpened,
  createSignedSlotVideoUpload,
  registerSlotVideo,
} from "@/lib/actions/content-calendar";
import {
  MAX_BATCH_SIZE,
  isSlotStale,
  type ContentSlotRecord,
  type ContentSlotStatus,
} from "@/lib/types/content-calendar";

const STATUS_LABELS: Record<ContentSlotStatus, string> = {
  assigned: "New",
  in_progress: "In progress",
  filmed: "Filmed",
  posted: "Posted",
  skipped: "Skipped",
};

const STATUS_TONE: Record<ContentSlotStatus, string> = {
  assigned: "bg-primary-500/10 text-primary-500",
  in_progress: "bg-status-yellow/10 text-status-yellow",
  filmed: "bg-status-green/10 text-status-green",
  posted: "bg-status-green/10 text-status-green",
  skipped: "bg-gray-200 text-gray-500",
};

export default function ContentCalendarClient({
  initialSlots,
}: {
  initialSlots: ContentSlotRecord[];
}) {
  const router = useRouter();
  const [slots, setSlots] = useState(initialSlots);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [generating, startGenerate] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const openSlots = slots.filter((s) => s.status !== "posted" && s.status !== "skipped");
  const doneSlots = slots.filter((s) => s.status === "posted" || s.status === "skipped");

  const handleGenerate = () => {
    startGenerate(async () => {
      const res = await generateNextBatch(MAX_BATCH_SIZE);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Generated ${res.generated} topic${res.generated === 1 ? "" : "s"}${
          res.errors > 0 ? ` (${res.errors} failed)` : ""
        }`
      );
      router.refresh();
    });
  };

  const handleExpand = async (slot: ContentSlotRecord) => {
    const next = expandedId === slot.id ? null : slot.id;
    setExpandedId(next);
    if (next && slot.status === "assigned") {
      await markSlotOpened(slot.id);
      setSlots((prev) =>
        prev.map((s) => (s.id === slot.id ? { ...s, status: "in_progress" } : s))
      );
    }
  };

  const handleRegenerate = async (slotId: string) => {
    setBusyId(slotId);
    const res = await regenerateSlot(slotId);
    setBusyId(null);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Regenerated");
    router.refresh();
  };

  const handleStatus = async (slotId: string, status: "posted" | "skipped") => {
    setBusyId(slotId);
    const res = await updateSlotStatus(slotId, status);
    setBusyId(null);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    setSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, status } : s)));
    router.refresh();
  };

  const handleUpload = async (slotId: string, file: File) => {
    setBusyId(slotId);
    try {
      const signed = await createSignedSlotVideoUpload(file.type);
      if (!signed.success) {
        toast.error(signed.error);
        return;
      }
      const put = await fetch(signed.url, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!put.ok) {
        toast.error("Upload failed");
        return;
      }
      const registered = await registerSlotVideo(slotId, signed.key);
      if (!registered.success) {
        toast.error(registered.error);
        return;
      }
      toast.success("Video attached");
      router.refresh();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-[900px]">
      <div className="flex items-start justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Content calendar</h1>
          <p className="text-text-secondary text-sm mt-0.5">
            AI picks the topic and briefs you on it. You film, upload, mark it posted.
          </p>
        </div>
        <Button size="sm" onClick={handleGenerate} disabled={generating} className="gap-1.5">
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Generate my next {MAX_BATCH_SIZE}
        </Button>
      </div>

      {openSlots.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-foreground font-semibold">Queue is empty</p>
          <p className="text-xs text-text-muted mt-1">
            Click &ldquo;Generate my next {MAX_BATCH_SIZE}&rdquo; to fill it.
          </p>
        </div>
      )}

      <ul className="space-y-2">
        {openSlots.map((slot) => (
          <SlotRow
            key={slot.id}
            slot={slot}
            expanded={expandedId === slot.id}
            busy={busyId === slot.id}
            onExpand={() => handleExpand(slot)}
            onRegenerate={() => handleRegenerate(slot.id)}
            onMarkPosted={() => handleStatus(slot.id, "posted")}
            onSkip={() => handleStatus(slot.id, "skipped")}
            onUpload={(file) => handleUpload(slot.id, file)}
          />
        ))}
      </ul>

      {doneSlots.length > 0 && (
        <details className="mt-6">
          <summary className="text-xs text-text-muted cursor-pointer">
            {doneSlots.length} done/skipped
          </summary>
          <ul className="mt-2 space-y-1">
            {doneSlots.map((slot) => (
              <li key={slot.id} className="flex items-center gap-2 text-xs text-text-muted py-1">
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] uppercase tracking-wide ${STATUS_TONE[slot.status]}`}
                >
                  {STATUS_LABELS[slot.status]}
                </span>
                <span className="truncate">{slot.topicTitle}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SlotRow({
  slot,
  expanded,
  busy,
  onExpand,
  onRegenerate,
  onMarkPosted,
  onSkip,
  onUpload,
}: {
  slot: ContentSlotRecord;
  expanded: boolean;
  busy: boolean;
  onExpand: () => void;
  onRegenerate: () => void;
  onMarkPosted: () => void;
  onSkip: () => void;
  onUpload: (file: File) => void;
}) {
  const [notes, setNotes] = useState(slot.notes ?? "");
  const [savingNotes, startSaveNotes] = useTransition();
  const stale = isSlotStale(slot);

  const saveNotes = () => {
    startSaveNotes(async () => {
      await updateSlotNotes(slot.id, notes);
    });
  };

  return (
    <li className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={onExpand}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight
            size={13}
            className={`shrink-0 text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
          />
          <span className="text-sm font-medium text-foreground truncate">{slot.topicTitle}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_TONE[slot.status]}`}>
            {STATUS_LABELS[slot.status]}
          </span>
          {stale && (
            <span className="inline-flex items-center gap-1 text-[10px] text-status-yellow shrink-0">
              <AlertTriangle size={11} /> may be stale — verify before posting
            </span>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-3 space-y-3">
          <div>
            <p className="text-xs font-semibold text-foreground mb-1">Talking points</p>
            <ul className="list-disc list-inside text-sm text-foreground space-y-0.5">
              {slot.topicBrief.talkingPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </div>

          {slot.topicBrief.stat && (
            <div className="text-sm">
              <p className="text-xs font-semibold text-foreground mb-1">Stat</p>
              <p className="text-foreground">{slot.topicBrief.stat}</p>
              {slot.topicBrief.statSourceUrl && (
                <a
                  href={slot.topicBrief.statSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary-500 inline-flex items-center gap-1 mt-0.5"
                >
                  <LinkIcon size={10} /> source — verify before posting
                </a>
              )}
            </div>
          )}

          {slot.topicBrief.contrarianAngle && (
            <div>
              <p className="text-xs font-semibold text-foreground mb-1">Contrarian angle</p>
              <p className="text-sm text-foreground">{slot.topicBrief.contrarianAngle}</p>
            </div>
          )}

          {slot.topicBrief.referenceLinks.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-foreground mb-1">Reference links</p>
              <ul className="space-y-0.5">
                {slot.topicBrief.referenceLinks.map((link, i) => (
                  <li key={i}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary-500 hover:underline"
                    >
                      {link.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            slot.topicBrief.noReferencesFound && (
              <p className="text-xs text-text-muted italic">No references found for this topic.</p>
            )
          )}

          <div>
            <p className="text-xs font-semibold text-foreground mb-1">Your notes</p>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="Draft your script or notes here..."
              rows={3}
            />
            {savingNotes && <p className="text-[10px] text-text-muted mt-0.5">Saving…</p>}
          </div>

          {slot.videoAssetUrl ? (
            <div className="flex items-center gap-2 text-xs text-status-green">
              <Check size={12} /> Video attached
            </div>
          ) : (
            <label className="inline-flex items-center gap-1.5 text-xs text-primary-500 cursor-pointer">
              <Upload size={12} />
              Upload video
              <input
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file);
                }}
              />
            </label>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={onRegenerate} disabled={busy} className="gap-1">
              <RefreshCw size={11} /> Regenerate
            </Button>
            <Button size="sm" onClick={onMarkPosted} disabled={busy} className="gap-1">
              <Check size={11} /> Mark posted
            </Button>
            <Button size="sm" variant="ghost" onClick={onSkip} disabled={busy} className="gap-1">
              <X size={11} /> Skip
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
