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
  TrendingUp,
  ExternalLink,
  Plus,
  Trash2,
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
  updateSlotDetails,
  markSlotOpened,
  createSignedSlotVideoUpload,
  registerSlotVideo,
  rescheduleSlot,
  getTrendPreview,
  createSlotFromTrend,
  createSlotForDate,
  deleteSlot,
} from "@/lib/actions/content-calendar";
import type { TrendCandidate } from "@/lib/scrape/trend-pull";
import {
  BATCH_SIZE_OPTIONS,
  DEFAULT_BATCH_SIZE,
  CONTENT_CATEGORY_OPTIONS,
  isSlotStale,
  type ContentSlotRecord,
  type ContentSlotStatus,
} from "@/lib/types/content-calendar";

const POST_PLATFORM_OPTIONS: { value: string; label: string }[] = [
  { value: "tiktok", label: "TikTok" },
  { value: "instagram_reels", label: "Instagram Reels" },
  { value: "youtube_shorts", label: "YouTube Shorts" },
];

// Tap-to-select reasons for Regenerate — the honest reason is usually not
// "give me a different topic," it's "I can't confidently talk about this
// one" (senior-uiux audit stage 04). A chip removes a second writing task
// from someone who's already stuck on the first one.
const REGEN_REASON_CHIPS = [
  "Too technical",
  "Don't know enough about this yet",
  "Not interested in this one",
  "Want something simpler",
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
  const [batchSize, setBatchSize] = useState<number>(DEFAULT_BATCH_SIZE);
  const [showTrends, setShowTrends] = useState(false);
  const [trends, setTrends] = useState<Array<TrendCandidate & { niche: string }> | null>(null);
  const [loadingTrends, startLoadTrends] = useTransition();
  const [addingTrend, setAddingTrend] = useState<number | null>(null);
  const [addedTrends, setAddedTrends] = useState<Set<number>>(new Set());
  const [addForDate, setAddForDate] = useState<string | null>(null);
  const [addInstruction, setAddInstruction] = useState("");
  const [addingForDate, startAddForDate] = useTransition();

  // Drag and drop rescheduling state
  const [draggedSlotId, setDraggedSlotId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, slotId: string) => {
    e.dataTransfer.setData("text/plain", slotId);
    e.dataTransfer.effectAllowed = "move";
    setDraggedSlotId(slotId);
  };

  const handleDragOver = (e: React.DragEvent, dateKey: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverDate !== dateKey) setDragOverDate(dateKey);
  };

  const handleDragLeave = (e: React.DragEvent, dateKey: string) => {
    if (dragOverDate === dateKey) setDragOverDate(null);
  };

  const handleDropSlot = async (e: React.DragEvent, targetDateKey: string) => {
    e.preventDefault();
    setDragOverDate(null);
    const slotId = e.dataTransfer.getData("text/plain") || draggedSlotId;
    if (!slotId) return;

    const slot = slots.find((s) => s.id === slotId);
    if (!slot || slot.scheduledDate === targetDateKey) {
      setDraggedSlotId(null);
      return;
    }
    const previousDateKey = slot.scheduledDate;

    // Optimistic local update
    setSlots((prev) =>
      prev.map((s) => (s.id === slotId ? { ...s, scheduledDate: targetDateKey } : s))
    );
    setDraggedSlotId(null);

    try {
      const res = await rescheduleSlot(slotId, targetDateKey);
      if (!res.success) {
        toast.error(res.error);
        router.refresh();
        return;
      }
      // Drag-and-drop reschedules on a card that's also click-to-open — an
      // imprecise pointer-down-then-move (easy on a trackpad) can fire this
      // with no deliberate drag intent. Undo is one click, not a confirmation
      // dialog on every drag, so it doesn't slow down real reschedules.
      toast.success("Rescheduled", undefined, {
        label: "Undo",
        onClick: () => void handleUndoReschedule(slotId, previousDateKey),
      });
      router.refresh();
    } catch {
      // rescheduleSlot can throw (not just return {success: false}) on a
      // transport-level failure — without this, the optimistic setSlots
      // above stays applied with nothing actually persisted and no
      // indication to the user that the move didn't take.
      setSlots((prev) =>
        prev.map((s) => (s.id === slotId ? { ...s, scheduledDate: previousDateKey } : s))
      );
      toast.error("Couldn't reschedule that slot. Please try again.");
    }
  };

  const handleUndoReschedule = async (slotId: string, previousDateKey: string) => {
    setSlots((prev) =>
      prev.map((s) => (s.id === slotId ? { ...s, scheduledDate: previousDateKey } : s))
    );
    try {
      const res = await rescheduleSlot(slotId, previousDateKey);
      if (!res.success) {
        toast.error(res.error);
        router.refresh();
        return;
      }
      toast.success("Undone");
      router.refresh();
    } catch {
      // Unlike handleDropSlot, there's no "previous" state to roll back to
      // here — this call *is* the rollback. Resync from the server instead
      // of guessing, since we don't know whether the undo partially applied.
      toast.error("Couldn't undo that reschedule. Please try again.");
      router.refresh();
    }
  };


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

  const handleGenerate = () => {
    startGenerate(async () => {
      const res = await generateNextBatch(batchSize, instruction.trim() || undefined);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      const rejectedCount = res.rejected?.length ?? 0;
      toast.success(
        `Generated ${res.generated} topic${res.generated === 1 ? "" : "s"}${
          res.errors > 0 ? ` (${res.errors} failed)` : ""
        }${rejectedCount > 0 ? ` — ${rejectedCount} candidate${rejectedCount === 1 ? "" : "s"} rejected for quality along the way` : ""}`
      );
      // Surfaced rather than silently shipping a batch that couldn't fully
      // cover every configured pillar within the self-correcting loop's
      // round cap — the creator should know to try again or adjust pillars,
      // not assume every pillar got a fresh topic this time.
      if (res.missingPillars && res.missingPillars.length > 0) {
        toast.error(`Couldn't find a passing topic for: ${res.missingPillars.join(", ")} — try generating again`);
      }
      setInstruction("");
      setShowInstruction(false);
      router.refresh();
    });
  };

  const handleToggleTrends = () => {
    const next = !showTrends;
    setShowTrends(next);
    if (next && trends === null) {
      startLoadTrends(async () => {
        const res = await getTrendPreview();
        if (!res.success) {
          toast.error(res.error);
          setTrends([]);
          return;
        }
        setTrends(res.trends);
      });
    }
  };

  const handleAddTrendTomorrow = async (t: TrendCandidate & { niche: string }, index: number) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setAddingTrend(index);
    const res = await createSlotFromTrend({
      title: t.title,
      url: t.url,
      niche: t.niche,
      scheduledDate: localDateKey(tomorrow),
    });
    setAddingTrend(null);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Added to tomorrow");
    setAddedTrends((prev) => new Set(prev).add(index));
    router.refresh();
  };

  const handleAddForDate = () => {
    if (!addForDate) return;
    startAddForDate(async () => {
      const res = await createSlotForDate(addForDate, addInstruction.trim() || undefined);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Added");
      setAddForDate(null);
      setAddInstruction("");
      router.refresh();
    });
  };

  const handleDeleteSlot = async (slotId: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== slotId));
    setSelectedSlotId(null);
    const res = await deleteSlot(slotId);
    if (!res.success) {
      toast.error(res.error);
      router.refresh();
      return;
    }
    toast.success("Deleted");
    router.refresh();
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
              variant={showTrends ? "default" : "tertiary"}
              size="icon"
              onClick={handleToggleTrends}
              aria-label="See what's trending in your niche"
              title="See what's trending in your niche"
            >
              <TrendingUp size={14} />
            </Button>
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
            <select
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              disabled={generating}
              aria-label="How many topics to generate"
              className="h-9 rounded-lg border border-border bg-transparent px-2 text-sm text-foreground disabled:opacity-50"
            >
              {BATCH_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <Button size="sm" onClick={handleGenerate} disabled={generating} className="gap-1.5">
              {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Generate my next {batchSize}
            </Button>
          </div>
        </div>
      </div>

      {showTrends && (
        <div className="mb-6 -mt-3 rounded-2xl border border-border/60 bg-card p-3">
          <p className="text-xs font-medium text-foreground mb-1.5">
            What&apos;s trending in your niche right now
          </p>
          {loadingTrends ? (
            <div className="flex items-center gap-2 text-xs text-text-muted py-2">
              <Loader2 size={12} className="animate-spin" /> Looking...
            </div>
          ) : trends && trends.length > 0 ? (
            <ul className="space-y-1.5 max-h-64 overflow-y-auto">
              {trends.slice(0, 25).map((t, i) => (
                <li key={i} className="flex items-start gap-2">
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start gap-1.5 text-xs text-foreground hover:text-primary-500 flex-1 min-w-0"
                  >
                    <ExternalLink size={11} className="shrink-0 mt-0.5 text-text-muted group-hover:text-primary-500" />
                    <span className="min-w-0">
                      {t.title}{" "}
                      <span className="text-text-muted">— {t.niche}</span>
                    </span>
                  </a>
                  {addedTrends.has(i) ? (
                    <span className="shrink-0 text-[10px] text-status-green inline-flex items-center gap-1 py-0.5">
                      <Check size={10} /> Added
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAddTrendTomorrow(t, i)}
                      disabled={addingTrend === i}
                      className="shrink-0 text-[10px] px-2 py-0.5 rounded-full border border-border/60 text-text-muted hover:text-primary-500 hover:border-primary-500 transition-colors disabled:opacity-50"
                    >
                      {addingTrend === i ? "Adding…" : "+ Tomorrow"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-text-muted italic py-1">
              Nothing surfaced right now — try again later, or generate directly and let the AI weigh trends for you.
            </p>
          )}
          <p className="text-[11px] text-text-muted mt-2">
            No AI involved here — this is the raw feed the AI itself reads from before picking a topic.
          </p>
        </div>
      )}

      {showInstruction && (
        <div className="mb-6 -mt-3 rounded-2xl border border-border/60 bg-card p-3">
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

      {openCount === 0 && (
        <div className="mb-6 rounded-2xl border border-border bg-card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-foreground mb-1">Nothing queued right now</p>
            <p className="text-sm text-text-secondary">
              Generate your next batch whenever you&apos;re ready to figure out what to film.
            </p>
          </div>
          <Button size="sm" onClick={handleGenerate} disabled={generating} className="gap-1.5 shrink-0">
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Generate my next {batchSize}
          </Button>
        </div>
      )}

      {addForDate && (
        <div className="mb-6 rounded-2xl border border-border/60 bg-card p-3">
          <p className="text-xs font-medium text-foreground mb-1.5">
            Add for{" "}
            {new Date(`${addForDate}T00:00:00`).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </p>
          <Textarea
            value={addInstruction}
            onChange={(e) => setAddInstruction(e.target.value)}
            placeholder="What do you want to talk about? (optional — leave blank and the AI picks from trends)"
            rows={2}
            className="text-sm"
            autoFocus
          />
          <div className="flex items-center gap-2 mt-2">
            <Button size="sm" onClick={handleAddForDate} disabled={addingForDate} className="gap-1.5">
              {addingForDate ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setAddForDate(null);
                setAddInstruction("");
              }}
              disabled={addingForDate}
            >
              Cancel
            </Button>
          </div>
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
            const isDragTarget = dragOverDate === key;
            const daySlots = slotsByDate.get(key) ?? [];
            return (
              <div
                key={key}
                onDragOver={(e) => handleDragOver(e, key)}
                onDragLeave={(e) => handleDragLeave(e, key)}
                onDrop={(e) => handleDropSlot(e, key)}
                className={`bg-card min-h-[64px] sm:min-h-[92px] p-1 sm:p-1.5 flex flex-col gap-1 transition-all ${
                  inMonth ? "" : "opacity-40"
                } ${isDragTarget ? "ring-2 ring-primary-500 bg-primary-500/10" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[10px] sm:text-[11px] w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center rounded-full shrink-0 ${
                      isToday ? "bg-primary-500 text-white font-semibold" : "text-text-muted"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setAddForDate(key);
                      setAddInstruction("");
                    }}
                    aria-label="Add content for this date"
                    title="Add content for this date"
                    className="p-0.5 rounded text-text-muted/60 hover:text-primary-500 transition-colors shrink-0"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto max-h-[110px] space-y-1">
                  {daySlots.map((slot) => {
                    const isDragging = draggedSlotId === slot.id;
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        data-testid="slot-card"
                        draggable
                        onDragStart={(e) => handleDragStart(e, slot.id)}
                        onDragEnd={() => setDraggedSlotId(null)}
                        onClick={() => handleSelectSlot(slot)}
                        title={slot.topicTitle}
                        className={`w-full text-left rounded-md border border-border/60 bg-sidebar/60 hover:bg-sidebar px-1 sm:px-1.5 py-1 transition-colors cursor-grab active:cursor-grabbing ${
                          isDragging ? "opacity-40 border-dashed border-primary-500" : ""
                        }`}
                      >
                        <div className="flex items-center gap-1 min-w-0">
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[slot.status]}`}
                          />
                          <span className="hidden sm:inline text-[10px] text-foreground truncate leading-tight flex-1 min-w-0">
                            {slot.topicTitle}
                          </span>
                        </div>
                        {slot.topicBrief?.category && (
                          <div className="hidden sm:block mt-0.5">
                            <span className="text-[9px] px-1 py-0.5 rounded bg-primary-500/10 text-primary-500 font-medium truncate max-w-full inline-block leading-tight">
                              {slot.topicBrief.category}
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}
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
          onDelete={() => handleDeleteSlot(selectedSlot.id)}
        />
      )}
    </div>
  );
}

function SlotPanel({
  slot,
  onClose,
  onChange,
  onDelete,
}: {
  slot: ContentSlotRecord;
  onClose: () => void;
  onChange: (patch: Partial<ContentSlotRecord>) => void;
  onDelete: () => void;
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

  // Full brief editing states
  const [isEditingBrief, setIsEditingBrief] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState(slot.topicBrief?.category ?? "");
  const [whyItMattersDraft, setWhyItMattersDraft] = useState(slot.topicBrief?.whyItMatters ?? "");
  const [talkingPointsDraft, setTalkingPointsDraft] = useState((slot.topicBrief?.talkingPoints ?? []).join("\n"));
  const [contrarianAngleDraft, setContrarianAngleDraft] = useState(slot.topicBrief?.contrarianAngle ?? "");
  const [savingBrief, setSavingBrief] = useState(false);

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
    setIsEditingBrief(false);
    setCategoryDraft(slot.topicBrief?.category ?? "");
    setWhyItMattersDraft(slot.topicBrief?.whyItMatters ?? "");
    setTalkingPointsDraft((slot.topicBrief?.talkingPoints ?? []).join("\n"));
    setContrarianAngleDraft(slot.topicBrief?.contrarianAngle ?? "");
  }, [slot.id, slot.notes, slot.scheduledDate, slot.topicTitle, slot.topicBrief]);

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

  // The standalone inline title editor and the full-brief edit form share
  // `titleDraft` (and the brief form owns its own category/whyItMatters/etc.
  // drafts). Entering or leaving either mode without resyncing from `slot`
  // let an abandoned, uncommitted edit in one form silently ride along into
  // a save triggered by the other — always resync on the way in and out.
  const resetBriefDrafts = () => {
    setTitleDraft(slot.topicTitle);
    setCategoryDraft(slot.topicBrief?.category ?? "");
    setWhyItMattersDraft(slot.topicBrief?.whyItMatters ?? "");
    setTalkingPointsDraft((slot.topicBrief?.talkingPoints ?? []).join("\n"));
    setContrarianAngleDraft(slot.topicBrief?.contrarianAngle ?? "");
  };

  const openEditBrief = () => {
    setEditingTitle(false);
    resetBriefDrafts();
    setIsEditingBrief(true);
  };

  const closeEditBrief = () => {
    resetBriefDrafts();
    setIsEditingBrief(false);
  };

  const handleSaveBrief = async () => {
    const trimmedTitle = titleDraft.trim();
    if (!trimmedTitle) {
      toast.error("Topic title cannot be empty");
      return;
    }
    setSavingBrief(true);
    const parsedPoints = talkingPointsDraft
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);

    const catValue = categoryDraft.trim() || null;
    const res = await updateSlotDetails(slot.id, {
      topicTitle: trimmedTitle,
      notes: notes,
      category: catValue,
      whyItMatters: whyItMattersDraft.trim(),
      talkingPoints: parsedPoints,
      contrarianAngle: contrarianAngleDraft.trim() || null,
    });
    setSavingBrief(false);

    if (!res.success) {
      toast.error(res.error);
      return;
    }

    toast.success("Brief details saved");
    onChange({
      topicTitle: trimmedTitle,
      notes: notes,
      topicBrief: {
        ...slot.topicBrief,
        category: catValue,
        whyItMatters: whyItMattersDraft.trim(),
        talkingPoints: parsedPoints,
        contrarianAngle: contrarianAngleDraft.trim() || null,
      },
    });
    setIsEditingBrief(false);
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

  const handleDelete = async () => {
    const ok = await dialogs.confirm({
      title: "Delete this slot?",
      subtitle: `"${slot.topicTitle}" and its brief, notes, and video will be permanently removed from the calendar. This can't be undone — use Skip instead if you just want to keep a record.`,
      tone: "destructive",
      confirmLabel: "Delete",
    });
    if (!ok) return;
    onDelete();
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
              {slot.topicBrief?.category && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary-500/10 text-primary-500 border border-primary-500/20 font-medium shrink-0">
                  <Tag size={10} /> {slot.topicBrief.category}
                </span>
              )}
              {slot.topicBrief?.pillar && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-sidebar border border-border/60 text-text-muted shrink-0">
                  {slot.topicBrief.pillar}
                </span>
              )}
              {stale && (
                <span className="inline-flex items-center gap-1 text-[10px] text-status-yellow shrink-0">
                  <AlertTriangle size={11} /> may be stale
                </span>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => (isEditingBrief ? closeEditBrief() : openEditBrief())}
                className={`p-1.5 rounded-lg border text-xs transition-colors flex items-center gap-1 ${
                  isEditingBrief
                    ? "bg-primary-500/10 text-primary-500 border-primary-500/30"
                    : "hover:bg-sidebar text-text-muted hover:text-foreground border-border/60"
                }`}
                title="Edit briefing details"
              >
                <Pencil size={13} />
                <span>{isEditingBrief ? "Editing" : "Edit info"}</span>
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="p-2.5 -m-0.5 rounded-lg hover:bg-status-red/10 text-text-muted hover:text-status-red"
                aria-label="Delete this slot"
                title="Delete this slot"
              >
                <Trash2 size={15} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-2.5 -m-0.5 rounded-lg hover:bg-sidebar text-text-muted hover:text-foreground"
                aria-label="Close panel"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {!isEditingBrief && (
            editingTitle ? (
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
                  aria-label="Edit topic title"
                  title="Edit topic title"
                >
                  <Pencil size={12} />
                </button>
              </div>
            )
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
          {isEditingBrief ? (
            <div className="space-y-3 border border-primary-500/20 bg-primary-500/5 p-3.5 rounded-2xl">
              <p className="text-xs font-semibold text-primary-500 flex items-center gap-1.5">
                <Pencil size={12} /> Edit Briefing & Content Details
              </p>

              <div>
                <label className="text-[11px] font-medium text-foreground block mb-1">Topic Title</label>
                <Input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  placeholder="Topic title..."
                  className="text-xs h-8 bg-card"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-foreground block mb-1">Category</label>
                <select
                  value={categoryDraft}
                  onChange={(e) => setCategoryDraft(e.target.value)}
                  className="w-full h-8 rounded-lg border border-border bg-card px-2 text-xs text-foreground"
                >
                  <option value="">(No category selected)</option>
                  {CONTENT_CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] font-medium text-foreground block mb-1">Why It Matters / Hook Summary</label>
                <Textarea
                  value={whyItMattersDraft}
                  onChange={(e) => setWhyItMattersDraft(e.target.value)}
                  placeholder="Plain-language orientation sentence..."
                  rows={2}
                  className="text-xs bg-card"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-foreground block mb-1">Talking Points (one per line)</label>
                <Textarea
                  value={talkingPointsDraft}
                  onChange={(e) => setTalkingPointsDraft(e.target.value)}
                  placeholder="Point 1&#10;Point 2&#10;Point 3"
                  rows={4}
                  className="text-xs bg-card"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-foreground block mb-1">Contrarian Angle (optional)</label>
                <Textarea
                  value={contrarianAngleDraft}
                  onChange={(e) => setContrarianAngleDraft(e.target.value)}
                  placeholder="Counter-take or contrarian angle..."
                  rows={2}
                  className="text-xs bg-card"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" onClick={handleSaveBrief} disabled={savingBrief} className="gap-1 text-xs">
                  {savingBrief ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  Save Briefing Details
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={closeEditBrief}
                  disabled={savingBrief}
                  className="text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              {slot.topicBrief?.whyItMatters && (
                <p className="text-sm text-foreground italic border-l-2 border-primary-500/40 pl-2.5">
                  {slot.topicBrief.whyItMatters}
                </p>
              )}

              <div>
                <p className="text-xs font-semibold text-foreground mb-1">Talking points</p>
                <ul className="list-disc list-inside text-sm text-foreground space-y-0.5">
                  {(slot.topicBrief?.talkingPoints ?? []).map((point, i) => (
                    <li key={i}>{point}</li>
                  ))}
                </ul>
              </div>
            </>
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

          {!isEditingBrief && slot.topicBrief.contrarianAngle && (
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
            <div className="flex flex-wrap gap-1.5">
              {REGEN_REASON_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setRegenReason(chip)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    regenReason === chip
                      ? "border-primary-500 bg-primary-500/10 text-primary-500"
                      : "border-border/60 text-text-muted hover:border-border"
                  }`}
                >
                  {chip}
                </button>
              ))}
            </div>
            <Textarea
              value={regenReason}
              onChange={(e) => setRegenReason(e.target.value)}
              placeholder="Or write your own reason..."
              rows={2}
              className="text-sm"
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
