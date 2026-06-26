"use client";

import { useRef, useState, useTransition } from "react";
import { CalendarClock, ChevronDown, Copy, Loader2, Send } from "lucide-react";
import { VoiceMicButton } from "@/components/ui/VoiceMicButton";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/utils";
import { generateDraft } from "@/lib/actions/compose";
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
  x: "X (Twitter)",
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

// Minimum datetime-local value: now + 5 min
function minScheduleTime(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  return d.toISOString().slice(0, 16);
}

export function Composer({ tenantSlug }: { tenantSlug: string }) {
  const [mode, setMode] = useState<ComposeMode>("original");
  const [input, setInput] = useState("");
  const [variants, setVariants] = useState<DraftVariants | null>(null);
  const [pending, startTransition] = useTransition();
  // Desktop: which secondary platforms have their card expanded
  const [expandedPlatforms, setExpandedPlatforms] = useState<Set<Platform>>(new Set());
  const [otherOpen, setOtherOpen] = useState(false);
  // Mobile: which platform tab is active
  const [mobilePlatform, setMobilePlatform] = useState<Platform>("x");
  // Schedule picker: which platform has the picker open
  const [schedulingPlatform, setSchedulingPlatform] = useState<Platform | null>(null);
  const [scheduleTime, setScheduleTime] = useState("");
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const xTextareaRef = useRef<HTMLTextAreaElement>(null);

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
      const res = await generateDraft(tenantSlug, { mode, sourceUrl, angle });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      const d = res.draft;
      setVariants({
        x: d.x ?? "",
        linkedin: d.linkedin ?? "",
        instagram: d.instagram ?? "",
        tiktok: d.tiktok ?? "",
        youtube: d.youtube ?? "",
        hooks: d.hooks ?? [],
      });
      setMobilePlatform("x");
      setOtherOpen(false);
      setExpandedPlatforms(new Set());
      requestAnimationFrame(() => xTextareaRef.current?.focus());
    });
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
    setScheduleTime(minScheduleTime());
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
    if (!text) {
      toast.error("No content to copy for this platform.");
      return;
    }
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

        <div>
          <Button type="button" onClick={handleGenerate} disabled={pending}>
            {pending ? (
              <>
                <Loader2 className="animate-spin" /> Drafting…
              </>
            ) : (
              "Draft in my voice"
            )}
          </Button>
        </div>
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
            {/* Platform chip row */}
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
            {/* Active platform textarea */}
            <textarea
              value={variants[mobilePlatform]}
              onChange={(e) => updateVariant(mobilePlatform, e.target.value)}
              rows={6}
              className="w-full resize-y bg-transparent text-base leading-relaxed text-gray-1200 outline-none"
              aria-label={`${PLATFORM_LABEL[mobilePlatform]} draft`}
            />
            {/* Hooks (X only) */}
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
            {/* Footer */}
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
            {/* Inline scheduler */}
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
              {/* Hooks */}
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
              {/* Footer */}
              <div className="mt-3 flex items-center justify-between border-t border-white-200 pt-3">
                <span className="text-xs text-gray-1000">Copy and post manually on X</span>
                <Button type="button" size="sm" onClick={() => handleCopy("x")}>
                  <Copy /> Copy
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
                Other platforms
              </button>

              {otherOpen && (
                <div className="mt-3 flex flex-col gap-2">
                  {/* Platform chip toggles */}
                  <div className="flex gap-2">
                    {SECONDARY_PLATFORMS.map((p) => {
                      const Icon = PLATFORM_ICON[p];
                      const expanded = expandedPlatforms.has(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => toggleSecondaryPlatform(p)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition",
                            expanded
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

                  {/* Expanded platform cards */}
                  {SECONDARY_PLATFORMS.filter((p) => expandedPlatforms.has(p)).map((p) => {
                    const Icon = PLATFORM_ICON[p];
                    return (
                      <div key={p} className="rounded-2xl border border-white-200 bg-card p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-gray-1100">
                            <Icon size={14} />
                            {PLATFORM_LABEL[p]}
                          </div>
                          <CharCount text={variants[p]} limit={PLATFORM_LIMIT[p]} />
                        </div>
                        <textarea
                          value={variants[p]}
                          onChange={(e) => updateVariant(p, e.target.value)}
                          rows={5}
                          className="w-full resize-y bg-transparent text-base leading-relaxed text-gray-1200 outline-none"
                          aria-label={`${PLATFORM_LABEL[p]} draft`}
                        />
                        <div className="mt-3 flex items-center justify-end gap-2 border-t border-white-200 pt-3">
                          <Button type="button" size="sm" variant="tertiary" onClick={() => openScheduler(p)}>
                            <CalendarClock size={13} /> Schedule
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
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
