"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { Mic, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/utils";
import { savePersonalOnboarding } from "@/lib/actions/personal-onboarding";
import { analyzeHandle } from "@/lib/actions/analyze-handle";

// A wide starter set — pick what fits, add your own.
const TOPIC_OPTIONS = [
  "Building in public",
  "Startups",
  "AI",
  "Design",
  "Engineering",
  "Career & jobs",
  "Productivity",
  "Marketing",
  "Leadership",
  "Personal growth",
  "Industry takes",
  "Behind the scenes",
  "Wins & lessons",
  "Hot takes",
];

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

export function PersonalOnboardingClient({ tenantSlug }: { tenantSlug: string }) {
  const [vibe, setVibe] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [customTopic, setCustomTopic] = useState("");
  const [example, setExample] = useState("");
  const [handlePlatform, setHandlePlatform] = useState<"x" | "linkedin">("x");
  const [handle, setHandle] = useState("");
  const [pending, startTransition] = useTransition();
  const [analyzing, startAnalyze] = useTransition();
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  function browserTz() {
    return typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  }

  function analyzeFromHandle() {
    if (!handle.trim()) {
      toast.error("Enter your handle to analyze.");
      return;
    }
    startAnalyze(async () => {
      const res = await analyzeHandle(tenantSlug, {
        platform: handlePlatform,
        handle,
        timezone: browserTz(),
      });
      // On success the action redirects; we only reach here on error.
      if (res?.error) toast.error(res.error);
    });
  }

  const voiceSupported = useSyncExternalStore(
    emptySubscribe,
    () => getSpeechRecognition() !== null,
    () => false
  );
  useEffect(() => () => recognitionRef.current?.stop(), []);

  function toggleTopic(topic: string) {
    setSelected((prev) =>
      prev.includes(topic) ? prev.filter((t) => t !== topic) : [...prev, topic]
    );
  }
  function addCustom() {
    const t = customTopic.trim();
    if (!t) return;
    if (!selected.includes(t)) setSelected((prev) => [...prev, t]);
    setCustomTopic("");
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
      const transcript = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join(" ");
      setVibe((prev) => (prev ? `${prev} ${transcript}` : transcript));
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

  function submit() {
    if (!vibe.trim() || selected.length === 0 || !example.trim()) {
      toast.error("Add your voice, pick at least one topic, and paste one example post.");
      return;
    }
    const timezone =
      typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
    startTransition(async () => {
      const res = await savePersonalOnboarding(tenantSlug, {
        vibe,
        pillars: selected,
        examplePosts: [example],
        timezone,
      });
      if (res && !res.success) toast.error(res.error);
    });
  }

  return (
    <div className="rounded-2xl border border-white-200 bg-card p-6 md:p-8">
      <h1 className="text-2xl font-bold text-gray-1100 [font-family:'Satoshi-700',var(--font-sans)]">
        Set up your voice
      </h1>
      <p className="mt-1 text-sm text-gray-1000">
        A few quick answers so the Composer drafts posts that sound like you. Change any of it later.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {/* Voice — with mic */}
        <div>
          <label htmlFor="vibe" className="mb-1 block text-sm font-medium text-gray-1200">
            Your voice in a sentence
          </label>
          <div className="relative">
            <textarea
              id="vibe"
              value={vibe}
              onChange={(e) => setVibe(e.target.value)}
              rows={2}
              placeholder="Talk or type — e.g. dry, direct, a little contrarian. Short sentences, no fluff."
              className="w-full resize-y rounded-lg border border-white-200 bg-card px-3 py-2 pr-12 text-base text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
            />
            {voiceSupported && (
              <button
                type="button"
                onClick={toggleVoice}
                aria-label={listening ? "Stop voice input" : "Talk to describe your voice"}
                aria-pressed={listening}
                className={cn(
                  "absolute right-2 top-2 grid size-9 place-items-center rounded-full transition",
                  listening ? "bg-primary-500 text-white" : "text-gray-1000 hover:bg-gray-50 hover:text-gray-1200"
                )}
              >
                <Mic className={cn("size-4", listening && "animate-pulse")} />
              </button>
            )}
          </div>
          {voiceSupported && (
            <p className="mt-1 text-xs text-gray-1000">Tap the mic to talk — it transcribes, then edit freely.</p>
          )}
        </div>

        {/* Topics — pick from a wide set + add your own */}
        <div>
          <span className="mb-2 block text-sm font-medium text-gray-1200">What do you post about?</span>
          <div className="flex flex-wrap gap-2">
            {TOPIC_OPTIONS.map((topic) => {
              const on = selected.includes(topic);
              return (
                <button
                  key={topic}
                  type="button"
                  onClick={() => toggleTopic(topic)}
                  aria-pressed={on}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm transition",
                    on ? "border-primary-500 bg-primary-50 text-primary-600" : "border-white-200 text-gray-1000 hover:border-gray-400"
                  )}
                >
                  {topic}
                </button>
              );
            })}
          </div>

          {/* Custom topics already added but not in the preset list */}
          {selected.filter((t) => !TOPIC_OPTIONS.includes(t)).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {selected
                .filter((t) => !TOPIC_OPTIONS.includes(t))
                .map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full border border-primary-500 bg-primary-50 px-3 py-1.5 text-sm text-primary-600"
                  >
                    {t}
                    <button type="button" onClick={() => toggleTopic(t)} aria-label={`Remove ${t}`}>
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
            </div>
          )}

          <div className="mt-2 flex gap-2">
            <input
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustom();
                }
              }}
              placeholder="Add your own topic"
              className="flex-1 rounded-lg border border-white-200 bg-card px-3 py-2 text-sm text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
            />
            <Button type="button" size="sm" variant="tertiary" onClick={addCustom}>
              <Plus /> Add
            </Button>
          </div>
        </div>

        {/* Example post */}
        <div>
          <label htmlFor="example" className="mb-1 block text-sm font-medium text-gray-1200">
            Paste one post that sounds like you
          </label>
          <textarea
            id="example"
            value={example}
            onChange={(e) => setExample(e.target.value)}
            rows={4}
            placeholder="A real post you've written. The AI matches this cadence and personality."
            className="w-full resize-y rounded-lg border border-white-200 bg-card px-3 py-2 text-base text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
          />
          <p className="mt-1 text-xs text-gray-1000">
            …or skip the typing and let us learn your voice from your posts:
          </p>
          <div className="mt-2 flex flex-col gap-2 rounded-xl border border-white-200 p-3 sm:flex-row sm:items-center">
            <select
              value={handlePlatform}
              onChange={(e) => setHandlePlatform(e.target.value as "x" | "linkedin")}
              aria-label="Platform"
              className="rounded-lg border border-white-200 bg-card px-3 py-2 text-sm text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
            >
              <option value="x">X</option>
              <option value="linkedin">LinkedIn</option>
            </select>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@yourhandle"
              className="flex-1 rounded-lg border border-white-200 bg-card px-3 py-2 text-sm text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
            />
            <Button type="button" size="sm" variant="tertiary" onClick={analyzeFromHandle} disabled={analyzing}>
              {analyzing ? "Analyzing…" : "Analyze my posts"}
            </Button>
          </div>
        </div>

        <div>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? "Setting up…" : "Start posting"}
          </Button>
        </div>
      </div>
    </div>
  );
}
