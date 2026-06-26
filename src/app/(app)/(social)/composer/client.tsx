"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CalendarClock, ChevronDown, Copy, FileText, Loader2, Send, Trash2 } from "lucide-react";
import { VoiceMicButton } from "@/components/ui/VoiceMicButton";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/utils";
import { generateDraft, deleteDraft, type SocialDraft } from "@/lib/actions/compose";
import { schedulePost, publishNow } from "@/lib/actions/schedule";
import type { ComposeMode } from "@/lib/ai/compose-take";
import {
  XIcon,
  LinkedInIcon,
  InstagramIcon,
  TikTokIcon,
  YouTubeIcon,
} from "@/components/icons/social";

const COMPOSE_MODES: ComposeMode[] = ["original", "reply", "quote"];
const MODE_LABEL: Record<ComposeMode, string> = {
  original: "Original",
  reply: "Reply",
  quote: "Quote",
};

const EXAMPLE_ANGLES = [
  "A hot take on something everyone in my space gets wrong",
  "What I learned shipping this week",
  "Reacting to a trend I keep seeing",
];

type Platform = "x" | "linkedin" | "instagram" | "tiktok" | "youtube";

const ALL_PLATFORMS: Platform[] = ["x", "linkedin", "instagram", "tiktok", "youtube"];
const SECONDARY_PLATFORMS: Platform[] = ["linkedin", "instagram", "tiktok", "youtube"];

const PLATFORM_LABEL: Record<Platform, string> = {
  x: "X",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
};

const PLATFORM_LIMIT: Record<Platform, number> = {
  x: 280,
  linkedin: 3000,
  instagram: 2200,
  tiktok: 2200,
  youtube: 5000,
};

const PLATFORM_COLOR: Record<Platform, string> = {
  x: "#000000",
  linkedin: "#0A66C2",
  instagram: "#E1306C",
  tiktok: "#010101",
  youtube: "#FF0000",
};

const PLATFORM_HINT: Record<Platform, string> = {
  x: "Tight · 280 chars",
  linkedin: "Long-form · storytelling",
  instagram: "Captions · hashtags",
  tiktok: "Short · trending",
  youtube: "Community post",
};

const PLATFORM_ICON: Record<Platform, React.ComponentType<{ size?: number; className?: string }>> = {
  x: XIcon,
  linkedin: LinkedInIcon,
  instagram: InstagramIcon,
  tiktok: TikTokIcon,
  youtube: YouTubeIcon,
};

interface DraftVariants {
  x: string;
  linkedin: string;
  instagram: string;
  tiktok: string;
  youtube: string;
  hooks: string[];
}

function CharCount({ text, limit }: { text: string; limit: number }) {
  return (
    <span
      className={cn(
        "text-xs tabular-nums",
        text.length > limit ? "text-red-500 font-medium" : "text-gray-1000"
      )}
    >
      {text.length}/{limit}
    </span>
  );
}

function minScheduleTime(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  return d.toISOString().slice(0, 16);
}

function DraftRow({
  draft,
  onOpen,
  onDelete,
}: {
  draft: SocialDraft;
  onOpen: (d: SocialDraft) => void;
  onDelete: (id: string) => void;
}) {
  const platform = (draft.primary_platform ?? "x") as Platform;
  const Icon = PLATFORM_ICON[platform] ?? XIcon;
  const color = PLATFORM_COLOR[platform] ?? "#666";
  const preview = draft.angle ?? draft.original_text;
  const date = new Date(draft.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white-200 bg-background px-3 py-2.5">
      <span style={{ color }} className="shrink-0">
        <Icon size={14} />
      </span>
      <p className="flex-1 truncate text-xs text-gray-1100">{preview}</p>
      <span className="shrink-0 text-xs text-gray-900">{date}</span>
      <button
        type="button"
        onClick={() => onOpen(draft)}
        className="shrink-0 text-xs font-medium text-primary-500 hover:text-primary-600 transition-colors"
      >
        Open
      </button>
      <button
        type="button"
        onClick={() => onDelete(draft.id)}
        aria-label="Delete draft"
        className="shrink-0 text-gray-400 hover:text-red-500 transition-colors"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

export function Composer({
  tenantSlug,
  initialAngle,
  initialDate: initialDateProp,
  hasConnections = true,
  initialDrafts = [],
}: {
  tenantSlug: string;
  initialAngle?: string;
  initialDate?: string;
  hasConnections?: boolean;
  initialDrafts?: SocialDraft[];
}) {
  const [mode, setMode] = useState<ComposeMode>("original");
  const [input, setInput] = useState(initialAngle ?? "");
  const [primaryPlatform, setPrimaryPlatform] = useState<Platform | null>(null);
  const [variants, setVariants] = useState<DraftVariants | null>(null);
  const [pending, startTransition] = useTransition();
  const [expandedPlatforms, setExpandedPlatforms] = useState<Set<Platform>>(new Set());
  const [otherOpen, setOtherOpen] = useState(false);
  const [mobilePlatform, setMobilePlatform] = useState<Platform>("x");
  const [schedulingPlatform, setSchedulingPlatform] = useState<Platform | null>(null);
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [drafts, setDrafts] = useState<SocialDraft[]>(initialDrafts);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const xTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeDate, setActiveDate] = useState<string | undefined>(initialDateProp);

  useEffect(() => {
    if (initialDateProp) {
      setScheduleTime(initialDateProp + "T09:00");
    }
  }, [initialDateProp]);

  function splitInput(raw: string): { sourceUrl?: string; angle?: string } {
    const trimmed = raw.trim();
    if (/^https?:\/\/\S+$/.test(trimmed)) return { sourceUrl: trimmed };
    const urlMatch = trimmed.match(/https?:\/\/\S+/);
    if (urlMatch) {
      return {
        sourceUrl: urlMatch[0],
        angle: trimmed.replace(urlMatch[0], "").trim() || undefined,
      };
    }
    return { angle: trimmed };
  }

  function handleGenerate() {
    const { sourceUrl, angle } = splitInput(input);
    if (!sourceUrl && !angle) {
      toast.error("Drop a link or type your take first.");
      return;
    }
    startTransition(async () => {
      const res = await generateDraft(tenantSlug, {
        mode,
        sourceUrl,
        angle,
        primaryPlatform: primaryPlatform ?? undefined,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      const d = res.draft;
      const newVariants: DraftVariants = {
        x: d.x ?? "",
        linkedin: d.linkedin ?? "",
        instagram: d.instagram ?? "",
        tiktok: d.tiktok ?? "",
        youtube: d.youtube ?? "",
        hooks: d.hooks ?? [],
      };
      setVariants(newVariants);
      setMobilePlatform(primaryPlatform ?? "x");
      setOtherOpen(true);
      setExpandedPlatforms(new Set());
      // Prepend to local drafts list
      const newDraft: SocialDraft = {
        id: d.id,
        mode,
        primary_platform: primaryPlatform,
        angle: (angle ?? sourceUrl ?? newVariants.x).slice(0, 200),
        original_text: newVariants.x || newVariants.linkedin || "",
        x_text: d.x,
        linkedin_text: d.linkedin,
        instagram_text: d.instagram,
        tiktok_text: d.tiktok,
        youtube_text: d.youtube,
        hooks_json: d.hooks,
        created_at: new Date().toISOString(),
      };
      setDrafts((prev) => [newDraft, ...prev]);
      requestAnimationFrame(() => {
        if (primaryPlatform === "linkedin") {
          setExpandedPlatforms(new Set(["linkedin"]));
        } else {
          xTextareaRef.current?.focus();
        }
      });
    });
  }

  function openDraft(draft: SocialDraft) {
    setVariants({
      x: draft.x_text ?? "",
      linkedin: draft.linkedin_text ?? "",
      instagram: draft.instagram_text ?? "",
      tiktok: draft.tiktok_text ?? "",
      youtube: draft.youtube_text ?? "",
      hooks: (draft.hooks_json as string[] | null) ?? [],
    });
    if (draft.primary_platform) {
      setPrimaryPlatform(draft.primary_platform as Platform);
      setMobilePlatform(draft.primary_platform as Platform);
      if ((SECONDARY_PLATFORMS as string[]).includes(draft.primary_platform)) {
        setExpandedPlatforms(new Set([draft.primary_platform as Platform]));
      }
    }
    if (draft.angle) setInput(draft.angle);
    setOtherOpen(true);
    setDraftsOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDeleteDraft(draftId: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
    const res = await deleteDraft(draftId);
    if (!res.success) {
      toast.error("Couldn't delete that draft.");
      // Don't re-add to list — optimistic delete is acceptable UX here
    }
  }

  function updateVariant(platform: Platform, text: string) {
    setVariants((prev) => (prev ? { ...prev, [platform]: text } : null));
  }

  function applyHook(hook: string) {
    if (!variants) return;
    const text = variants.x;
    const match = text.match(/^.+?[.!?](?:\s|$)/);
    const rest = match ? text.slice(match[0].length).trimStart() : "";
    updateVariant("x", rest ? `${hook} ${rest}` : hook);
    requestAnimationFrame(() => xTextareaRef.current?.focus());
  }

  function openScheduler(platform: Platform) {
    setSchedulingPlatform(platform);
    if (!scheduleTime) setScheduleTime(minScheduleTime());
  }

  async function handleSchedule(platform: Platform) {
    if (!variants) return;
    const content = variants[platform];
    if (!content) { toast.error("No content to schedule."); return; }
    if (!scheduleTime) { toast.error("Pick a time first."); return; }
    setScheduleLoading(true);
    const res = await schedulePost({
      platform,
      content,
      scheduledFor: new Date(scheduleTime).toISOString(),
    });
    setScheduleLoading(false);
    if (res.error) { toast.error(res.error); return; }
    toast.success("Post scheduled! View it in Schedule.");
    setSchedulingPlatform(null);
  }

  async function handlePostNow(platform: Platform) {
    if (!variants) return;
    const content = variants[platform];
    if (!content) { toast.error("No content to post."); return; }
    setScheduleLoading(true);
    const res = await publishNow({ platform, content });
    setScheduleLoading(false);
    if (res.error) { toast.error(res.error); return; }
    toast.success("Post queued for immediate publishing.");
  }

  async function handleCopy(platform: Platform) {
    if (!variants) return;
    const text = variants[platform];
    if (!text) { toast.error("No content to copy for this platform."); return; }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied — paste it where you post.");
    } catch {
      toast.error("Couldn't copy — select the text and copy manually.");
    }
  }

  function toggleSecondaryPlatform(platform: Platform) {
    setExpandedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-1100 [font-family:'Satoshi-700',var(--font-sans)]">
          Composer
        </h1>
        <p className="mt-1 text-sm text-gray-1000">
          Drop a link or type your take. Get platform-native drafts in your voice — edit, copy, post.
        </p>
      </div>

      {/* Mode pills */}
      <div className="flex gap-2" role="tablist" aria-label="Draft mode">
        {COMPOSE_MODES.map((m) => (
          <Button
            key={m}
            type="button"
            size="sm"
            variant={mode === m ? "default" : "tertiary"}
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
          >
            {MODE_LABEL[m]}
          </Button>
        ))}
      </div>

      {/* Platform selector */}
      <div className="flex flex-col gap-2">
        <p className="text-xs text-gray-1000">
          Drafting for
          {primaryPlatform && (
            <button
              type="button"
              onClick={() => setPrimaryPlatform(null)}
              className="ml-2 text-gray-900 hover:text-gray-1100 transition-colors"
            >
              (clear)
            </button>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {ALL_PLATFORMS.map((p) => {
            const Icon = PLATFORM_ICON[p];
            const selected = primaryPlatform === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPrimaryPlatform(selected ? null : p)}
                title={PLATFORM_HINT[p]}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition",
                  selected
                    ? "border-primary-500 bg-primary-50 text-primary-600 font-medium"
                    : "border-white-200 text-gray-1100 hover:border-gray-400"
                )}
              >
                <Icon size={12} />
                {PLATFORM_LABEL[p]}
                {selected && (
                  <span className="text-[10px] text-primary-400 font-normal">
                    · {PLATFORM_HINT[p]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Date chip */}
      {activeDate && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-2.5 py-1 text-xs text-primary-500">
            Drafting for{" "}
            {new Date(activeDate + "T00:00:00").toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
            <button
              type="button"
              onClick={() => setActiveDate(undefined)}
              className="text-primary-400 hover:text-primary-600 leading-none"
              aria-label="Clear date"
            >
              ✕
            </button>
          </span>
        </div>
      )}

      {/* Input area */}
      <div className="flex flex-col gap-3">
        <label htmlFor="composer-input" className="sr-only">
          Link or your take
        </label>
        <div className="flex flex-col gap-1">
          <textarea
            id="composer-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            placeholder="Drop a link or type your take…"
            className="w-full resize-y rounded-2xl border border-white-200 bg-card px-4 py-3 text-base text-gray-1200 outline-none placeholder:text-gray-400 focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
          />
          <div className="flex justify-end pr-1">
            <VoiceMicButton
              onTranscript={(t) => setInput((prev) => (prev ? `${prev} ${t}` : t))}
            />
          </div>
        </div>

        {!variants && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_ANGLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setInput(ex)}
                className="rounded-full border border-white-200 px-3 py-1.5 text-xs text-gray-1000 transition hover:border-gray-400 hover:text-gray-1200"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <Button type="button" onClick={handleGenerate} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="animate-spin" /> Drafting…
              </>
            ) : (
              "Draft in my voice"
            )}
          </Button>

          {drafts.length > 0 && (
            <button
              type="button"
              onClick={() => setDraftsOpen((p) => !p)}
              className="flex items-center gap-1.5 text-sm text-gray-1000 hover:text-gray-1200 transition"
            >
              <FileText size={14} />
              My drafts ({drafts.length})
              <ChevronDown
                size={14}
                className={cn(
                  "transition-transform duration-200",
                  draftsOpen && "rotate-180"
                )}
              />
            </button>
          )}
        </div>

        {/* Drafts list */}
        {draftsOpen && drafts.length > 0 && (
          <div className="flex flex-col gap-1.5 rounded-2xl border border-white-200 bg-card p-3">
            <p className="mb-1 text-xs font-medium text-gray-1000">Saved drafts</p>
            {drafts.map((d) => (
              <DraftRow
                key={d.id}
                draft={d}
                onOpen={openDraft}
                onDelete={handleDeleteDraft}
              />
            ))}
          </div>
        )}
      </div>

      {/* Skeleton */}
      {pending && !variants && (
        <div className="rounded-2xl border border-white-200 bg-card p-4">
          <div className="h-4 w-1/3 animate-pulse rounded bg-gray-100 mb-4" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-gray-100" />
          <div className="mt-2 h-4 w-full animate-pulse rounded bg-gray-100" />
          <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-gray-100" />
        </div>
      )}

      {/* Draft cards */}
      {variants && (
        <>
          {/* ── MOBILE: horizontal chip row + swappable textarea ── */}
          <div className="md:hidden rounded-2xl border border-white-200 bg-card p-4">
            <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-3 mb-3 border-b border-white-200">
              {ALL_PLATFORMS.map((p) => {
                const Icon = PLATFORM_ICON[p];
                const active = mobilePlatform === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setMobilePlatform(p)}
                    className={cn(
                      "flex-none flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition",
                      active
                        ? "border-primary-500 bg-primary-50 text-primary-600"
                        : "border-white-200 text-gray-1100 hover:border-gray-400"
                    )}
                  >
                    <Icon size={12} />
                    {PLATFORM_LABEL[p]}
                  </button>
                );
              })}
            </div>
            <textarea
              value={variants[mobilePlatform]}
              onChange={(e) => updateVariant(mobilePlatform, e.target.value)}
              rows={mobilePlatform === "linkedin" ? 10 : 6}
              className="w-full resize-y bg-transparent text-base leading-relaxed text-gray-1200 outline-none"
              aria-label={`${PLATFORM_LABEL[mobilePlatform]} draft`}
            />
            {mobilePlatform === "x" && variants.hooks.length > 0 && (
              <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-white-200 pt-3">
                <span className="text-xs text-gray-1000 pt-0.5 shrink-0">Try a hook →</span>
                {variants.hooks.map((h, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => applyHook(h)}
                    className="rounded-full border border-white-200 px-3 py-1 text-xs text-gray-1000 hover:border-gray-400 hover:text-gray-1200 transition text-left"
                  >
                    {h}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-white-200 pt-3">
              <CharCount text={variants[mobilePlatform]} limit={PLATFORM_LIMIT[mobilePlatform]} />
              <div className="flex items-center gap-2">
                {mobilePlatform !== "x" && (
                  <Button type="button" size="sm" variant="tertiary" onClick={() => openScheduler(mobilePlatform)}>
                    <CalendarClock size={13} /> Schedule
                  </Button>
                )}
                <Button type="button" size="sm" onClick={() => handleCopy(mobilePlatform)}>
                  <Copy /> Copy
                </Button>
              </div>
            </div>
            {schedulingPlatform === mobilePlatform && mobilePlatform !== "x" && (
              <div className="mt-3 flex flex-col gap-2 border-t border-white-200 pt-3">
                <label className="text-xs text-gray-1000">Schedule for</label>
                <input
                  type="datetime-local"
                  min={minScheduleTime()}
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="rounded-xl border border-white-200 bg-card px-3 py-2 text-sm text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
                />
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={() => handleSchedule(mobilePlatform)} disabled={scheduleLoading}>
                    {scheduleLoading ? <Loader2 size={13} className="animate-spin" /> : <CalendarClock size={13} />}
                    {scheduleLoading ? "Scheduling…" : "Schedule"}
                  </Button>
                  <Button type="button" size="sm" variant="tertiary" onClick={() => handlePostNow(mobilePlatform)} disabled={scheduleLoading}>
                    <Send size={13} /> Post now
                  </Button>
                  <button type="button" onClick={() => setSchedulingPlatform(null)} className="ml-auto text-xs text-gray-1000 hover:text-gray-1200">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── DESKTOP: X primary + "Other platforms" accordion ── */}
          <div className="hidden md:flex flex-col gap-3">
            {/* X primary card */}
            <div className="rounded-2xl border border-white-200 bg-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-1100">
                  <XIcon size={14} />
                  X (Twitter)
                  {primaryPlatform === "x" && (
                    <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] text-primary-500">Primary</span>
                  )}
                </div>
                <CharCount text={variants.x} limit={280} />
              </div>
              <textarea
                ref={xTextareaRef}
                value={variants.x}
                onChange={(e) => updateVariant("x", e.target.value)}
                rows={6}
                className="w-full resize-y bg-transparent text-base leading-relaxed text-gray-1200 outline-none"
                aria-label="X draft"
              />
              {variants.hooks.length > 0 && (
                <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-white-200 pt-3">
                  <span className="text-xs text-gray-1000 pt-0.5 shrink-0">Try a hook →</span>
                  {variants.hooks.map((h, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => applyHook(h)}
                      className="rounded-full border border-white-200 px-3 py-1 text-xs text-gray-1000 hover:border-gray-400 hover:text-gray-1200 transition text-left"
                    >
                      {h}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between border-t border-white-200 pt-3">
                <span className="text-xs text-gray-1000">Direct X publishing coming soon</span>
                <Button type="button" size="sm" variant="tertiary" onClick={() => handleCopy("x")}>
                  <Copy size={13} /> Copy for X
                </Button>
              </div>
            </div>

            {/* Other platforms accordion */}
            <div>
              <button
                type="button"
                onClick={() => setOtherOpen((p) => !p)}
                className="flex items-center gap-1.5 text-sm text-gray-1000 hover:text-gray-1200 transition"
              >
                <ChevronDown
                  className={cn(
                    "size-4 transition-transform duration-200",
                    otherOpen && "rotate-180"
                  )}
                />
                Schedule to other platforms
              </button>

              {otherOpen && (
                <div className="mt-3 flex flex-col gap-2">
                  {!hasConnections && (
                    <div className="rounded-xl border border-border bg-card p-4 text-center">
                      <p className="text-sm font-medium text-foreground mb-1">Connect your accounts to schedule</p>
                      <p className="text-xs text-text-muted mb-3">Link LinkedIn, Instagram, TikTok, or YouTube to start posting.</p>
                      <a
                        href="/settings/social-publishing"
                        className="inline-flex items-center gap-1.5 rounded-full bg-primary-500 px-4 py-2 text-xs font-medium text-white hover:bg-primary-600 transition-colors"
                      >
                        Connect accounts →
                      </a>
                    </div>
                  )}
                  {hasConnections && (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {SECONDARY_PLATFORMS.map((p) => {
                          const Icon = PLATFORM_ICON[p];
                          const expanded = expandedPlatforms.has(p);
                          const isPrimary = primaryPlatform === p;
                          return (
                            <button
                              key={p}
                              type="button"
                              onClick={() => toggleSecondaryPlatform(p)}
                              className={cn(
                                "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition",
                                expanded
                                  ? "border-primary-500 bg-primary-50 text-primary-600"
                                  : isPrimary
                                  ? "border-primary-200 text-primary-500 hover:border-primary-400"
                                  : "border-white-200 text-gray-1100 hover:border-gray-400"
                              )}
                            >
                              <Icon size={12} />
                              {PLATFORM_LABEL[p]}
                              {isPrimary && (
                                <span className="text-[10px] text-primary-400">· primary</span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {SECONDARY_PLATFORMS.filter((p) => expandedPlatforms.has(p)).map((p) => {
                        const Icon = PLATFORM_ICON[p];
                        return (
                          <div key={p} className="rounded-2xl border border-white-200 bg-card p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2 text-sm font-medium text-gray-1100">
                                <Icon size={14} />
                                {PLATFORM_LABEL[p]}
                                {primaryPlatform === p && (
                                  <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] text-primary-500">Primary</span>
                                )}
                              </div>
                              <CharCount text={variants[p]} limit={PLATFORM_LIMIT[p]} />
                            </div>
                            <textarea
                              value={variants[p]}
                              onChange={(e) => updateVariant(p, e.target.value)}
                              rows={p === "linkedin" ? 10 : 5}
                              className="w-full resize-y bg-transparent text-base leading-relaxed text-gray-1200 outline-none"
                              aria-label={`${PLATFORM_LABEL[p]} draft`}
                            />
                            <div className="mt-3 flex items-center justify-end gap-2 border-t border-white-200 pt-3">
                              <Button type="button" size="sm" variant="tertiary" onClick={() => openScheduler(p)}>
                                <CalendarClock size={13} /> Schedule
                              </Button>
                              <Button type="button" size="sm" variant="tertiary" onClick={() => handlePostNow(p)} disabled={scheduleLoading}>
                                <Send size={13} /> Post now
                              </Button>
                              <Button type="button" size="sm" onClick={() => handleCopy(p)}>
                                <Copy /> Copy
                              </Button>
                            </div>
                            {schedulingPlatform === p && (
                              <div className="mt-3 flex flex-col gap-2 border-t border-white-200 pt-3">
                                <label className="text-xs text-gray-1000">Schedule for</label>
                                <input
                                  type="datetime-local"
                                  min={minScheduleTime()}
                                  value={scheduleTime}
                                  onChange={(e) => setScheduleTime(e.target.value)}
                                  className="rounded-xl border border-white-200 bg-card px-3 py-2 text-sm text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
                                />
                                <div className="flex gap-2">
                                  <Button type="button" size="sm" onClick={() => handleSchedule(p)} disabled={scheduleLoading}>
                                    {scheduleLoading ? <Loader2 size={13} className="animate-spin" /> : <CalendarClock size={13} />}
                                    {scheduleLoading ? "Scheduling…" : "Schedule"}
                                  </Button>
                                  <Button type="button" size="sm" variant="tertiary" onClick={() => handlePostNow(p)} disabled={scheduleLoading}>
                                    <Send size={13} /> Post now
                                  </Button>
                                  <button type="button" onClick={() => setSchedulingPlatform(null)} className="ml-auto text-xs text-gray-1000 hover:text-gray-1200">
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
