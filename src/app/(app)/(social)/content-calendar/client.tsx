"use client";

import { useState, useMemo, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  Upload,
  Check,
  X,
  AlertTriangle,
  Link as LinkIcon,
  ChevronLeft,
  ChevronRight,
  CalendarClock,
  SlidersHorizontal,
  Pencil,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/Toaster";
import { useDialogs } from "@/components/ui/Dialog";
import {
  generateNextBatch,
  regenerateSlot,
  updateSlotStatus,
  updateSlotNotes,
  updateSlotTopic,
  markSlotOpened,
  createSignedSlotVideoUpload,
  registerSlotVideo,
  rescheduleSlot,
} from "@/lib/actions/content-calendar";
import {
  MAX_BATCH_SIZE,
  MAX_QUEUE_DEPTH,
  isSlotStale,
  type ContentSlotRecord,
  type ContentSlotStatus,
} from "@/lib/types/content-calendar";

const POST_PLATFORM_OPTIONS: { value: string; label: string }[] = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram_reels", label: "Instagram Reels" },
  { value: "youtube_shorts", label: "YouTube Shorts" },
];

const STATUS_LABELS: Record<ContentSlotStatus, string> = {
  assigned: "New",
  in_progress: "In progress",
  filmed: "Filmed",
  posted: "Posted",
  skipped: "Skipped",
};

// `assigned` deliberately does NOT use bg-primary-500/text-primary-500—
// brand maroon is reserved for the one "act here" CTA (Generate). Reusing
// it as one of five status colors, repeated across every day cell, diluted
// that signal (senior-uiux review, 2026-07-09).
const STATUS_TONE: Record<ContentSlotStatus, string> = {
  assigned: "bg-status-teal/10 text-status-teal",
  in_progress: "bg-status-yellow/10 text-status-yellow",
  filmed: "bg-status-green/10 text-status-green",
  posted: "bg-status-green/10 text-status-green",
  skipped: "bg-gray-200 text-gray-500",
};

const STATUS_DOT: Record<ContentSlotStatus, string> = {
  assigned: "bg-status-teal",
  in_progress: "bg-status-yellow",
  filmed: "bg-status-green",
  posted: "bg-status-green",
  skipped: "bg-gray-400",
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// 6 full weeks (42 cells) starting the Sunday on/before the 1st — a fixed
// grid size keeps the layout stable across months with 4-6 visible weeks.
function buildMonthGrid(viewDate: Date): Date[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const start = new Date(year, month, 1);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export default function ContentCalendarClient({
  initialSlots,
}: {
  initialSlots: ContentSlotRecord[];
}) {
  const router = useRouter();
  const [slots, setSlots] = useState(initialSlots);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [generating, startGenerate] = useTransition();
  const [showInstruction, setShowInstruction] = useState(false);
  const [instruction, setInstruction] = useState("");

  useEffect(() => {
    setSlots(initialSlots);
  }, [initialSlots]);

  const slotsByDate = useMemo(() => {
    const map = new Map<string, ContentSlotRecord[]>();
    for (const s of slots) {
      const arr = map.get(s.scheduledDate) ?? [];
      arr.push(s);
      map.set(s.scheduledDate, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.position - b.position);
    return map;
  }, [slots]);

  const monthGrid = useMemo(() => buildMonthGrid(viewDate), [viewDate]);
  const currentMonth = viewDate.getMonth();
  const todayKey = localDateKey(new Date());
  const monthLabel = viewDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const selectedSlot = slots.find((s) => s.id === selectedSlotId) ?? null;
  const openCount = slots.filter(
    (s) => s.status === "assigned" || s.status === "in_progress"
  ).length;
  const nearCap = openCount >= MAX_QUEUE_DEPTH - MAX_BATCH_SIZE;

  const handleGenerate = () => {
    startGenerate(async () => {
      const res = await generateNextBatch(MAX_BATCH_SIZE, instruction.trim() || undefined);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Generated ${res.generated} topic${res.generated === 1 ? "" : "s"}${
          res.errors > 0 ? ` (${res.errors} failed)` : ""
        }`
      );
      setInstruction("");
      setShowInstruction(false);
      router.refresh();
    });
  };

  const handleSelectSlot = async (slot: ContentSlotRecord) => {
    setSelectedSlotId(slot.id);
    if (slot.status === "assigned") {
      await markSlotOpened(slot.id);
      setSlots((prev) =>
        prev.map((s) => (s.id === slot.id ? { ...s, status: "in_progress" } : s))
      );
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-[1100px]">
      <div className="flex items-start justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Content calendar</h1>
          <p className="text-text-secondary text-sm mt-0.5">
            AI picks the topic and briefs you on it. You film, upload, mark it posted.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 w-full sm:w-auto">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant={showInstruction ? "default" : "tertiary"}
              size="icon"
              onClick={() => setShowInstruction((v) => !v)}
              aria-label="Add a one-off direction for this batch"
              title="Add a one-off direction for this batch"
            >
              <SlidersHorizontal size={14} />
            </Button>
            <Button size="sm" onClick={handleGenerate} disabled={generating} className="gap-1.5">
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Generate my next {MAX_BATCH_SIZE}
            </Button>
          </div>
          <span className={`text-[11px] ${nearCap ? "text-status-yellow" : "text-text-muted"}`}>
            {openCount}/{MAX_QUEUE_DEPTH} in queue
            {nearCap && " — work through some before generating more"}
          </span>
        </div>
      </div>

      {showInstruction && (
        <div className="mb-6 -mt-3 rounded-xl border border-border/60 bg-card p-3">
          <p className="text-xs font-medium text-foreground mb-1.5">
            One-off direction for this batch (optional)
          </p>
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g. Focus on AI coding tools today, skip anything about big-model releases"
            rows={2}
            className="text-sm"
          />
          <p className="text-[11px] text-text-muted mt-1">
            Doesn&apos;t change your saved content pillars or interests — just steers this one batch.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-2.5 sm:p-4 md:p-5">
        <div className="flex items-center justify-between mb-3 sm:mb-4 gap-2 flex-wrap px-1 sm:px-0">
          <h2 className="text-base sm:text-lg font-semibold text-foreground">{monthLabel}</h2>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
              }
              className="p-1.5 rounded-lg hover:bg-sidebar text-text-muted hover:text-foreground"
              aria-label="Previous month"
            >
              <ChevronLeft size={16} />
            </button>
            <Button size="xs" variant="tertiary" onClick={() => setViewDate(new Date())}>
              Today
            </Button>
            <button
              type="button"
              onClick={() =>
                setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
              }
              className="p-1.5 rounded-lg hover:bg-sidebar text-text-muted hover:text-foreground"
              aria-label="Next month"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px bg-border/50 rounded-lg overflow-hidden border border-border/50">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="bg-sidebar px-0.5 sm:px-2 py-1 sm:py-1.5 text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide text-text-muted text-center"
            >
              <span className="sm:hidden">{label.slice(0, 1)}</span>
              <span className="hidden sm:inline">{label}</span>
            </div>
          ))}
          {monthGrid.map((day) => {
            const key = localDateKey(day);
            const inMonth = day.getMonth() === currentMonth;
            const isToday = key === todayKey;
            const daySlots = slotsByDate.get(key) ?? [];
            return (
              <div
                key={key}
                className={`bg-card min-h-[64px] sm:min-h-[92px] p-1 sm:p-1.5 flex flex-col gap-1 ${
                  inMonth ? "" : "opacity-40"
                }`}
              >
                <span
                  className={`text-[10px] sm:text-[11px] w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center rounded-full shrink-0 ${
                    isToday ? "bg-primary-500 text-white font-semibold" : "text-text-muted"
                  }`}
                >
                  {day.getDate()}
                </span>
                <div className="flex-1 min-h-0 overflow-y-auto max-h-[110px] space-y-1">
                  {daySlots.map((slot) => (
                    <button
                      key={slot.id}
                      type="button"
                      data-testid="slot-card"
                      onClick={() => handleSelectSlot(slot)}
                      title={slot.topicTitle}
                      className="w-full text-left rounded-md border border-border/60 bg-sidebar/60 hover:bg-sidebar px-1 sm:px-1.5 py-1 transition-colors"
                    >
                      <div className="flex items-center gap-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[slot.status]}`}
                        />
                        {/* Below sm: too narrow for readable truncated text
                            (7 columns on a ~375px screen) — the dot alone
                            signals "something's scheduled here", tap opens
                            the panel with the full title. */}
                        <span className="hidden sm:inline text-[10px] text-foreground truncate leading-tight">
                          {slot.topicTitle}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedSlot && (
        <SlotPanel
          slot={selectedSlot}
          onClose={() => setSelectedSlotId(null)}
          onChange={(patch) =>
            setSlots((prev) =>
              prev.map((s) => (s.id === selectedSlot.id ? { ...s, ...patch } : s))
            )
          }
        />
      )}
    </div>
  );
}

function SlotPanel({
  slot,
  onClose,
  onChange,
}: {
  slot: ContentSlotRecord;
  onClose: () => void;
  onChange: (patch: Partial<ContentSlotRecord>) => void;
}) {
  const router = useRouter();
  const dialogs = useDialogs();
  const [notes, setNotes] = useState(slot.notes ?? "");
  const [savingNotes, startSaveNotes] = useTransition();
  const [busy, setBusy] = useState(false);
  const [showPostPicker, setShowPostPicker] = useState(false);
  const [postPlatforms, setPostPlatforms] = useState<string[]>([]);
  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(slot.scheduledDate);
  const [showRegenReason, setShowRegenReason] = useState(false);
  const [regenReason, setRegenReason] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(slot.topicTitle);
  const [savingTitle, setSavingTitle] = useState(false);
  const stale = isSlotStale(slot);

  useEffect(() => {
    setNotes(slot.notes ?? "");
    setShowPostPicker(false);
    setPostPlatforms([]);
    setShowReschedule(false);
    setRescheduleDate(slot.scheduledDate);
    setShowRegenReason(false);
    setRegenReason("");
    setEditingTitle(false);
    setTitleDraft(slot.topicTitle);
  }, [slot.id, slot.notes, slot.scheduledDate, slot.topicTitle]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const saveNotes = () => {
    startSaveNotes(async () => {
      await updateSlotNotes(slot.id, notes);
      onChange({ notes });
    });
  };

  const handleRegenerate = async () => {
    setBusy(true);
    const res = await regenerateSlot(slot.id, regenReason.trim() || undefined);
    setBusy(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Regenerated");
    setShowRegenReason(false);
    setRegenReason("");
    router.refresh();
  };

  const handleSaveTitle = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      toast.error("Topic can't be empty");
      return;
    }
    setSavingTitle(true);
    const res = await updateSlotTopic(slot.id, trimmed);
    setSavingTitle(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    onChange({ topicTitle: trimmed });
    setEditingTitle(false);
    router.refresh();
  };

  const handleStatus = async (status: "posted" | "skipped", platforms?: string[]) => {
    setBusy(true);
    const res = await updateSlotStatus(slot.id, status, platforms);
    setBusy(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    onChange({ status, ...(platforms ? { platforms } : {}) });
    router.refresh();
  };

  const handleConfirmPosted = () => {
    if (postPlatforms.length === 0) {
      toast.error("Pick at least one platform.");
      return;
    }
    handleStatus("posted", postPlatforms);
  };

  const handleSkip = async () => {
    const ok = await dialogs.confirm({
      title: "Skip this topic?",
      subtitle: `"${slot.topicTitle}" will be marked skipped and won't count toward your open queue.`,
      tone: "destructive",
      confirmLabel: "Skip",
    });
    if (!ok) return;
    handleStatus("skipped");
  };

  const togglePostPlatform = (value: string) => {
    setPostPlatforms((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]
    );
  };

  const handleReschedule = async () => {
    setBusy(true);
    const res = await rescheduleSlot(slot.id, rescheduleDate);
    setBusy(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    onChange({ scheduledDate: rescheduleDate });
    setShowReschedule(false);
    toast.success("Moved");
    router.refresh();
  };

  const handleUpload = async (file: File) => {
    setBusy(true);
    try {
      const signed = await createSignedSlotVideoUpload(file.type);
      if (!signed.success) {
        toast.error(signed.error);
        return;
      }
      const put = await fetch(signed.url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!put.ok) {
        toast.error("Upload failed");
        return;
      }
      const registered = await registerSlotVideo(slot.id, signed.key);
      if (!registered.success) {
        toast.error(registered.error);
        return;
      }
      toast.success("Video attached");
      onChange({ videoAssetUrl: registered.url, status: "filmed" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-label={`Content slot: ${slot.topicTitle}`}
        className="fixed right-0 inset-y-0 z-50 w-full sm:w-[480px] bg-card border-l border-border shadow-2xl flex flex-col animate-slide-in-right"
      >
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/60 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_TONE[slot.status]}`}>
                {STATUS_LABELS[slot.status]}
              </span>
              <button
                type="button"
                onClick={() => setShowReschedule((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-primary-500 shrink-0"
              >
                <CalendarClock size={11} />
                {new Date(`${slot.scheduledDate}T00:00:00`).toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </button>
              {slot.topicBrief.pillar && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-sidebar border border-border/60 text-text-muted shrink-0">
                  <Tag size={10} /> {slot.topicBrief.pillar}
                </span>
              )}
              {stale && (
                <span className="inline-flex items-center gap-1 text-[10px] text-status-yellow shrink-0">
                  <AlertTriangle size={11} /> may be stale
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-sidebar text-text-muted hover:text-foreground shrink-0"
              aria-label="Close panel"
            >
              <X size={16} />
            </button>
          </div>
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                className="h-8 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveTitle();
                  if (e.key === "Escape") {
                    setEditingTitle(false);
                    setTitleDraft(slot.topicTitle);
                  }
                }}
              />
              <Button size="xs" onClick={handleSaveTitle} disabled={savingTitle}>
                Save
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setEditingTitle(false);
                  setTitleDraft(slot.topicTitle);
                }}
                disabled={savingTitle}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-start gap-1.5 group">
              <h2 className="text-sm font-semibold text-foreground">{slot.topicTitle}</h2>
              <button
                type="button"
                onClick={() => setEditingTitle(true)}
                className="p-0.5 rounded text-text-muted hover:text-primary-500 shrink-0 mt-0.5"
                aria-label="Edit topic"
                title="Edit topic directly"
              >
                <Pencil size={12} />
              </button>
            </div>
          )}
          {showReschedule && (
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={rescheduleDate}
                onChange={(e) => setRescheduleDate(e.target.value)}
                className="h-8 text-xs"
              />
              <Button size="xs" onClick={handleReschedule} disabled={busy}>
                Move
              </Button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
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

          {slot.topicBrief.creatorExamples.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-foreground mb-1">How others are covering this</p>
              <ul className="space-y-0.5">
                {slot.topicBrief.creatorExamples.map((link, i) => (
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
            slot.topicBrief.noCreatorExamplesFound && (
              <p className="text-xs text-text-muted italic">
                No creator posts found for this topic — social platforms are weakly indexed by search, so this is common.
              </p>
            )
          )}

          <div>
            <p className="text-xs font-semibold text-foreground mb-1">Your notes</p>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="Draft your script or notes here..."
              rows={4}
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
                  if (file) handleUpload(file);
                }}
              />
            </label>
          )}
        </div>

        {showPostPicker && (
          <div className="shrink-0 border-t border-border/60 px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-foreground">Posted to:</p>
            <div className="flex flex-wrap gap-2">
              {POST_PLATFORM_OPTIONS.map((opt) => {
                const checked = postPlatforms.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => togglePostPlatform(opt.value)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      checked
                        ? "border-primary-500 bg-primary-500/10 text-primary-500"
                        : "border-border/60 text-text-muted hover:border-border"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={handleConfirmPosted} disabled={busy} className="gap-1">
                <Check size={11} /> Confirm posted
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowPostPicker(false)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {showRegenReason && (
          <div className="shrink-0 border-t border-border/60 px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-foreground">What should change? (optional)</p>
            <Textarea
              value={regenReason}
              onChange={(e) => setRegenReason(e.target.value)}
              placeholder="e.g. Too generic, want something more contrarian / about X instead"
              rows={2}
              className="text-sm"
              autoFocus
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleRegenerate} disabled={busy} className="gap-1">
                {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Regenerate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowRegenReason(false);
                  setRegenReason("");
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="shrink-0 border-t border-border/60 px-4 py-3 flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowRegenReason((v) => !v)}
            disabled={busy}
            className="gap-1"
          >
            <RefreshCw size={11} /> Regenerate
          </Button>
          <Button
            size="sm"
            onClick={() => setShowPostPicker((v) => !v)}
            disabled={busy}
            className="gap-1"
          >
            <Check size={11} /> Mark posted
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSkip}
            disabled={busy}
            className="gap-1"
          >
            <X size={11} /> Skip
          </Button>
        </div>
      </div>
    </>
  );
}
