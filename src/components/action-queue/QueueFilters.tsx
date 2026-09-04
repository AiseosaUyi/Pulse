"use client";

export interface QueueFilterState {
  platform: string;
  kind: string;
}

const PLATFORMS = ["instagram", "tiktok", "twitter", "linkedin"];
const KINDS: Array<{ value: string; label: string }> = [
  { value: "reply", label: "Reply" },
  { value: "follow_up", label: "Follow-up" },
  { value: "decision", label: "Decision" },
  { value: "escalation", label: "Escalation" },
  { value: "opportunity", label: "Opportunity" },
  { value: "chore", label: "Chore" },
];

export function QueueFilters({
  value,
  onChange,
}: {
  value: QueueFilterState;
  onChange: (next: QueueFilterState) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3">
      <select
        value={value.platform}
        onChange={(e) => onChange({ ...value, platform: e.target.value })}
        className="h-8 px-2.5 rounded-lg border border-border bg-transparent text-xs text-foreground outline-none focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/30 cursor-pointer"
      >
        <option value="">All platforms</option>
        {PLATFORMS.map((p) => (
          <option key={p} value={p} className="capitalize">
            {p}
          </option>
        ))}
      </select>

      <select
        value={value.kind}
        onChange={(e) => onChange({ ...value, kind: e.target.value })}
        className="h-8 px-2.5 rounded-lg border border-border bg-transparent text-xs text-foreground outline-none focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/30 cursor-pointer"
      >
        <option value="">All kinds</option>
        {KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
    </div>
  );
}
