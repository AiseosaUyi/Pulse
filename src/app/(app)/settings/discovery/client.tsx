"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { saveDiscoveryConfig } from "@/lib/actions/discovery";
import { toast } from "@/components/ui/Toaster";
import type { TenantDiscoveryConfig } from "@/lib/scrape/discovery-config";

interface SourceDraft {
  label: string;
  startUrls: string;
  includeUrlGlobs: string;
  excludeUrlGlobs: string;
}

function toDraft(c: TenantDiscoveryConfig | null): {
  enabled: boolean;
  sources: SourceDraft[];
} {
  if (!c) {
    return {
      enabled: true,
      sources: [
        { label: "", startUrls: "", includeUrlGlobs: "", excludeUrlGlobs: "" },
      ],
    };
  }
  return {
    enabled: c.enabled,
    sources: c.sources.map((s) => ({
      label: s.label,
      startUrls: s.startUrls.join("\n"),
      includeUrlGlobs: s.includeUrlGlobs.join("\n"),
      excludeUrlGlobs: (s.excludeUrlGlobs ?? []).join("\n"),
    })),
  };
}

const lines = (s: string) =>
  s.split("\n").map((x) => x.trim()).filter(Boolean);

export function DiscoveryClient({
  initial,
}: {
  initial: TenantDiscoveryConfig | null;
}) {
  const start = toDraft(initial);
  const [enabled, setEnabled] = useState(start.enabled);
  const [sources, setSources] = useState<SourceDraft[]>(start.sources);
  const [pending, startTransition] = useTransition();

  function update(i: number, patch: Partial<SourceDraft>) {
    setSources((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function addSource() {
    setSources((prev) => [
      ...prev,
      { label: "", startUrls: "", includeUrlGlobs: "", excludeUrlGlobs: "" },
    ]);
  }
  function removeSource(i: number) {
    setSources((prev) => prev.filter((_, idx) => idx !== i));
  }

  function save() {
    startTransition(async () => {
      const res = await saveDiscoveryConfig({
        enabled,
        sources: sources.map((s) => ({
          label: s.label,
          startUrls: lines(s.startUrls),
          includeUrlGlobs: lines(s.includeUrlGlobs),
          excludeUrlGlobs: lines(s.excludeUrlGlobs),
        })),
      });
      res.success
        ? toast.success("Discovery sources saved")
        : toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enable nightly discovery for this workspace
      </label>

      {sources.map((s, i) => (
        <div key={i} className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <input
              value={s.label}
              onChange={(e) => update(i, { label: e.target.value })}
              placeholder="Source name (e.g. Drinks.ng)"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <button
              onClick={() => removeSource(i)}
              className="text-text-muted hover:text-primary-500 p-2"
              aria-label="Remove source"
            >
              <Trash2 size={16} />
            </button>
          </div>
          <Field
            label="Start URLs (one per line)"
            value={s.startUrls}
            onChange={(v) => update(i, { startUrls: v })}
            placeholder="https://drinks.ng/brands"
          />
          <Field
            label="Include URL globs (one per line)"
            value={s.includeUrlGlobs}
            onChange={(v) => update(i, { includeUrlGlobs: v })}
            placeholder="https://drinks.ng/brands/*"
          />
          <Field
            label="Exclude URL globs (optional)"
            value={s.excludeUrlGlobs}
            onChange={(v) => update(i, { excludeUrlGlobs: v })}
            placeholder="https://drinks.ng/blog/*"
          />
        </div>
      ))}

      <div className="flex items-center justify-between">
        <button
          onClick={addSource}
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-foreground"
        >
          <Plus size={16} /> Add source
        </button>
        <button
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary-500 text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          <Save size={15} /> {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted mb-1 block">{label}</span>
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
      />
    </label>
  );
}
