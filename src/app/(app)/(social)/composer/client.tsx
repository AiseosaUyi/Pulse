"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { ChevronDown, Copy, Loader2, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/utils";
import { generateDraft } from "@/lib/actions/compose";
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

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const emptySubscribe = () => () => {};

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

export function Composer({ tenantSlug }: { tenantSlug: string }) {
  const [mode, setMode] = useState<ComposeMode>("original");
  const [input, setInput] = useState("");
  const [variants, setVariants] = useState<DraftVariants | null>(null);
  const [pending, startTransition] = useTransition();
  const [listening, setListening] = useState(false);
  // Desktop: which secondary platforms have their card expanded
  const [expandedPlatforms, setExpandedPlatforms] = useState<Set<Platform>>(new Set());
  const [otherOpen, setOtherOpen] = useState(false);
  // Mobile: which platform tab is active
  const [mobilePlatform, setMobilePlatform] = useState<Platform>("x");
  const xTextareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const voiceSupported = useSyncExternalStore(
    emptySubscribe,
    () => getSpeechRecognition() !== null,
    () => false
  );

  useEffect(() => () => recognitionRef.current?.stop(), []);

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

  function toggleVoice() {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      toast.error("Voice input isn't supported in this browser — type instead.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new Recognition();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.continuous = false;
    rec.onresult = (e) => {
      const transcript = Array.from(
        { length: e.results.length },
        (_, i) => e.results[i][0].transcript
      ).join(" ");
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onerror = () => {
      toast.error("Mic blocked or unavailable — type instead.");
      setListening(false);
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
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
        <div className="relative">
          <textarea
            id="composer-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            placeholder="Drop a link or type your take…"
            className="w-full resize-y rounded-2xl border border-white-200 bg-card px-4 py-3 pr-12 text-base text-gray-1200 outline-none placeholder:text-gray-400 focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
          />
          {voiceSupported && (
            <button
              type="button"
              onClick={toggleVoice}
              aria-label={listening ? "Stop voice input" : "Start voice input"}
              aria-pressed={listening}
              className={cn(
                "absolute right-3 top-3 grid size-9 place-items-center rounded-full transition",
                listening
                  ? "bg-primary-500 text-white"
                  : "text-gray-1000 hover:bg-gray-50 hover:text-gray-1200"
              )}
            >
              <Mic className={cn("size-4", listening && "animate-pulse")} />
            </button>
          )}
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
              <Button type="button" size="sm" onClick={() => handleCopy(mobilePlatform)}>
                <Copy /> Copy
              </Button>
            </div>
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
              <div className="mt-3 flex items-center justify-end border-t border-white-200 pt-3">
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
                        <div className="mt-3 flex items-center justify-end border-t border-white-200 pt-3">
                          <Button type="button" size="sm" onClick={() => handleCopy(p)}>
                            <Copy /> Copy
                          </Button>
                        </div>
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
