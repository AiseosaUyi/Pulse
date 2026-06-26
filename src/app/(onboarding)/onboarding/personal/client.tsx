"use client";

import { useTransition, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/utils";
import { savePersonalOnboarding } from "@/lib/actions/personal-onboarding";
import { analyzeHandle } from "@/lib/actions/analyze-handle";
import { VoiceMicButton } from "@/components/ui/VoiceMicButton";

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

export function PersonalOnboardingClient({ tenantSlug }: { tenantSlug: string }) {
  const [vibe, setVibe] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [customTopic, setCustomTopic] = useState("");
  const [example, setExample] = useState("");
  const [handlePlatform, setHandlePlatform] = useState<"x" | "linkedin">("x");
  const [handle, setHandle] = useState("");
  const [pending, startTransition] = useTransition();
  const [analyzing, startAnalyze] = useTransition();

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
          <textarea
            id="vibe"
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
            rows={2}
            placeholder="Talk or type — e.g. dry, direct, a little contrarian. Short sentences, no fluff."
            className="w-full resize-y rounded-lg border border-white-200 bg-card px-3 py-2 text-base text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
          />
          <div className="mt-1 flex items-center justify-between">
            <p className="text-xs text-gray-1000">Tap the mic to talk — it transcribes, then edit freely.</p>
            <VoiceMicButton
              onTranscript={(t) => setVibe((prev) => (prev ? `${prev} ${t}` : t))}
            />
          </div>
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
