"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/lib/utils";
import { saveCadenceConfig } from "@/lib/actions/cadence";
import {
  cadencePlatforms,
  PLATFORM_LABEL,
  type CadenceConfig,
  type CadencePlatform,
  type CadenceWindow,
} from "@/lib/cadence/types";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function newWindowId(): string {
  return `w_${Math.random().toString(36).slice(2, 8)}`;
}

export function CadenceEditor({
  tenantSlug,
  initial,
}: {
  tenantSlug: string;
  initial: CadenceConfig;
}) {
  const browserTz =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const [config, setConfig] = useState<CadenceConfig>({
    ...initial,
    timezone: initial.timezone && initial.timezone !== "UTC" ? initial.timezone : browserTz,
  });
  const [pending, startTransition] = useTransition();

  function patch(p: Partial<CadenceConfig>) {
    setConfig((c) => ({ ...c, ...p }));
  }
  function setTarget(platform: CadencePlatform, value: number) {
    setConfig((c) => ({ ...c, targets: { ...c.targets, [platform]: Math.max(0, value || 0) } }));
  }
  function patchWindow(id: string, p: Partial<CadenceWindow>) {
    setConfig((c) => ({ ...c, windows: c.windows.map((w) => (w.id === id ? { ...w, ...p } : w)) }));
  }
  function addWindow() {
    setConfig((c) => ({
      ...c,
      windows: [
        ...c.windows,
        { id: newWindowId(), label: "New window", platform: "x", time: "12:00", days: [1, 2, 3, 4, 5] },
      ],
    }));
  }
  function removeWindow(id: string) {
    setConfig((c) => ({ ...c, windows: c.windows.filter((w) => w.id !== id) }));
  }
  function toggleDay(id: string, day: number) {
    setConfig((c) => ({
      ...c,
      windows: c.windows.map((w) =>
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
    if (config.windows.some((w) => w.days.length === 0)) {
      toast.error("Every window needs at least one active day.");
      return;
    }
    startTransition(async () => {
      const res = await saveCadenceConfig(tenantSlug, config);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Cadence saved.");
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Enable + per-platform targets + tz */}
      <div className="flex flex-col gap-4 rounded-2xl border border-white-200 bg-card p-5">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="size-4 accent-primary-500"
          />
          <span className="text-sm font-medium text-gray-1200">Track my posting cadence</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          {cadencePlatforms.map((p) => (
            <div key={p}>
              <label htmlFor={`target-${p}`} className="mb-1 block text-sm text-gray-1000">
                {PLATFORM_LABEL[p]} per day
              </label>
              <input
                id={`target-${p}`}
                type="number"
                min={0}
                max={20}
                value={config.targets[p]}
                onChange={(e) => setTarget(p, Number(e.target.value))}
                className="w-full rounded-lg border border-white-200 bg-card px-3 py-2 text-base text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
              />
            </div>
          ))}
          <div>
            <label htmlFor="timezone" className="mb-1 block text-sm text-gray-1000">
              Timezone
            </label>
            <input
              id="timezone"
              type="text"
              value={config.timezone}
              onChange={(e) => patch({ timezone: e.target.value })}
              placeholder="America/New_York"
              className="w-full rounded-lg border border-white-200 bg-card px-3 py-2 text-base text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
            />
          </div>
        </div>
      </div>

      {/* Windows */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-1100">Posting windows</h3>
          <Button type="button" size="xs" variant="tertiary" onClick={addWindow}>
            <Plus /> Add window
          </Button>
        </div>

        {config.windows.length === 0 && (
          <p className="text-sm text-gray-1000">No windows yet — add one to set your beat.</p>
        )}

        {config.windows.map((w) => (
          <div key={w.id} className="flex flex-col gap-3 rounded-2xl border border-white-200 bg-card p-4">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={w.platform}
                onChange={(e) => patchWindow(w.id, { platform: e.target.value as CadencePlatform })}
                aria-label="Platform"
                className="rounded-lg border border-white-200 bg-card px-3 py-2 text-base text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
              >
                {cadencePlatforms.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABEL[p]}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={w.label}
                onChange={(e) => patchWindow(w.id, { label: e.target.value })}
                aria-label="Window label"
                className="min-w-32 flex-1 rounded-lg border border-white-200 bg-card px-3 py-2 text-base text-gray-1200 outline-none focus-visible:ring-[3px] focus-visible:ring-blue-500/30"
              />
              <input
                type="time"
                value={w.time}
                onChange={(e) => patchWindow(w.id, { time: e.target.value })}
                aria-label="Window time"
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
          {pending ? "Saving…" : "Save cadence"}
        </Button>
      </div>
    </div>
  );
}
