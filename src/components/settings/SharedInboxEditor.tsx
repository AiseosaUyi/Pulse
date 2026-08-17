"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/utils";
import { saveSharedInboxConfig } from "@/lib/actions/shared-inbox-settings";
import type { SharedInboxConfig, OfficeHoursWindow } from "@/lib/shared-inbox/types";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function newWindowId(): string {
  return `oh_${Math.random().toString(36).slice(2, 8)}`;
}

export function SharedInboxEditor({
  tenantSlug,
  initial,
}: {
  tenantSlug: string;
  initial: SharedInboxConfig;
}) {
  const browserTz =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const [config, setConfig] = useState<SharedInboxConfig>({
    ...initial,
    timezone: initial.timezone && initial.timezone !== "UTC" ? initial.timezone : browserTz,
  });
  const [pending, startTransition] = useTransition();

  function patch(p: Partial<SharedInboxConfig>) {
    setConfig((c) => ({ ...c, ...p }));
  }
  function patchWindow(id: string, p: Partial<OfficeHoursWindow>) {
    setConfig((c) => ({
      ...c,
      officeHours: c.officeHours.map((w) => (w.id === id ? { ...w, ...p } : w)),
    }));
  }
  function addWindow() {
    setConfig((c) => ({
      ...c,
      officeHours: [
        ...c.officeHours,
        { id: newWindowId(), label: "Working hours", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
      ],
    }));
  }
  function removeWindow(id: string) {
    setConfig((c) => ({ ...c, officeHours: c.officeHours.filter((w) => w.id !== id) }));
  }
  function toggleDay(id: string, day: number) {
    setConfig((c) => ({
      ...c,
      officeHours: c.officeHours.map((w) =>
        w.id === id
          ? {
              ...w,
              days: w.days.includes(day)
                ? w.days.filter((d) => d !== day)
                : [...w.days, day].sort((a, b) => a - b),
            }
          : w
      ),
    }));
  }

  function save() {
    if (config.officeHours.some((w) => w.days.length === 0)) {
      toast.error("Every office-hours window needs at least one active day.");
      return;
    }
    startTransition(async () => {
      const res = await saveSharedInboxConfig(tenantSlug, config);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("AI inbox coverage saved.");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Enable + always-on + confidence + tz */}
      <div className="flex flex-col gap-4 rounded-2xl border border-white-200 bg-card p-5">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="size-4 accent-primary-500"
          />
          <span className="text-sm font-medium text-gray-1200">Turn on AI inbox coverage</span>
        </label>
        <p className="text-xs text-gray-1000 -mt-2 ml-7">
          Off by default. Even when on, a workspace-wide safety switch can halt AI sending at any
          time regardless of this setting.
        </p>

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={config.alwaysOn}
            onChange={(e) => patch({ alwaysOn: e.target.checked })}
            className="size-4 accent-primary-500"
            disabled={!config.enabled}
          />
          <span className={cn("text-sm font-medium", config.enabled ? "text-gray-1200" : "text-gray-1000")}>
            Always on (ignore office hours below — AI covers around the clock)
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="auto-send-confidence" className="mb-1 block text-sm text-gray-1000">
              Auto-send confidence threshold
            </label>
            <input
              id="auto-send-confidence"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={config.autoSendConfidence}
              onChange={(e) =>
                patch({ autoSendConfidence: Math.min(1, Math.max(0, Number(e.target.value) || 0)) })
              }
              className="w-full rounded-lg border border-white-200 bg-card px-3 py-2 text-base text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
            />
            <p className="mt-1 text-xs text-gray-1000">
              Drafts scoring at or above this (0–1) auto-send. Below it, they wait as
              &ldquo;needs review&rdquo; in the inbox.
            </p>
          </div>
          <div>
            <label htmlFor="shared-inbox-timezone" className="mb-1 block text-sm text-gray-1000">
              Timezone
            </label>
            <input
              id="shared-inbox-timezone"
              type="text"
              value={config.timezone}
              onChange={(e) => patch({ timezone: e.target.value })}
              placeholder="America/New_York"
              className="w-full rounded-lg border border-white-200 bg-card px-3 py-2 text-base text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
            />
          </div>
        </div>
      </div>

      {/* Office hours windows */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-1100">Office hours (human-covered)</h3>
            <p className="text-xs text-gray-1000">
              AI covers outside all of these windows. No windows configured means AI covers
              whenever it&apos;s on.
            </p>
          </div>
          <Button type="button" size="xs" variant="tertiary" onClick={addWindow}>
            <Plus /> Add window
          </Button>
        </div>

        {config.officeHours.length === 0 && (
          <p className="text-sm text-gray-1000">No office-hours windows yet — AI will cover full-time once enabled.</p>
        )}

        {config.officeHours.map((w) => (
          <div key={w.id} className="flex flex-col gap-3 rounded-2xl border border-white-200 bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={w.label}
                onChange={(e) => patchWindow(w.id, { label: e.target.value })}
                aria-label="Window label"
                className="min-w-32 flex-1 rounded-lg border border-white-200 bg-card px-3 py-2 text-base text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
              />
              <input
                type="time"
                value={w.start}
                onChange={(e) => patchWindow(w.id, { start: e.target.value })}
                aria-label="Window start time"
                className="rounded-lg border border-white-200 bg-card px-3 py-2 text-base text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
              />
              <span className="text-sm text-gray-1000">to</span>
              <input
                type="time"
                value={w.end}
                onChange={(e) => patchWindow(w.id, { end: e.target.value })}
                aria-label="Window end time"
                className="rounded-lg border border-white-200 bg-card px-3 py-2 text-base text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
              />
              <button
                type="button"
                onClick={() => removeWindow(w.id)}
                aria-label={`Remove ${w.label} window`}
                className="grid size-9 place-items-center rounded-full text-gray-1000 hover:bg-gray-50 hover:text-error-500"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="flex gap-1.5">
              {DAY_LABELS.map((lbl, day) => {
                const on = w.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(w.id, day)}
                    aria-label={DAY_NAMES[day]}
                    aria-pressed={on}
                    className={cn(
                      "size-8 rounded-full text-xs font-medium transition",
                      on ? "bg-primary-500 text-white" : "border border-white-200 text-gray-1000 hover:border-gray-400"
                    )}
                  >
                    {lbl}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div>
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save AI inbox coverage"}
        </Button>
      </div>
    </div>
  );
}
