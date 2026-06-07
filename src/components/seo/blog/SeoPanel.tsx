// SEO-specific signals panel for the blog-writer sidebar. Sits below
// ScoreBreakdown (the 0-100 rubric) and surfaces the supplementary
// signals from scoreSeoExtras() — meta tag length, length-vs-SERP,
// image alt coverage, internal links, JSON-LD presence.
//
// These signals don't change the rubric total; they're gauges the
// editor uses to ship a clean draft. Statuses:
//   good   = teal  — at target
//   warn   = yellow — close to target, fixable
//   bad    = red    — missing or far off
//   skipped = muted — not applicable for this draft (e.g. no images)

import type {
  GaugeSignal,
  GaugeStatus,
  SeoExtras,
} from "@/lib/ai/seo/score-seo-extras";

const STATUS_BADGE: Record<GaugeStatus, string> = {
  good: "bg-status-teal/10 text-status-teal border-status-teal/30",
  warn: "bg-status-yellow/10 text-status-yellow border-status-yellow/30",
  bad: "bg-status-red/10 text-status-red border-status-red/30",
  skipped: "bg-sidebar text-text-muted border-border",
};

const STATUS_DOT: Record<GaugeStatus, string> = {
  good: "bg-status-teal",
  warn: "bg-status-yellow",
  bad: "bg-status-red",
  skipped: "bg-border",
};

const ROW_ORDER: Array<{ key: keyof SeoExtras; label: string }> = [
  { key: "metaTitle", label: "Meta title" },
  { key: "metaDescription", label: "Meta description" },
  { key: "lengthVsSerp", label: "Length vs SERP" },
  { key: "internalLinks", label: "Internal links" },
  { key: "externalAuthority", label: "External authority" },
  { key: "imageAlts", label: "Image alt text" },
  { key: "jsonLd", label: "Structured data" },
];

export function SeoPanel({ extras }: { extras: SeoExtras | null }) {
  if (!extras) {
    return (
      <div className="rounded-xl border border-dashed border-border p-5 text-sm text-text-muted">
        SEO signals appear after the first save.
      </div>
    );
  }

  const counts = ROW_ORDER.reduce(
    (acc, { key }) => {
      const s = extras[key].status;
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    },
    { good: 0, warn: 0, bad: 0, skipped: 0 } as Record<GaugeStatus, number>
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">SEO signals</h3>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <SummaryDot status="good" count={counts.good} />
          <SummaryDot status="warn" count={counts.warn} />
          <SummaryDot status="bad" count={counts.bad} />
        </div>
      </div>
      <ul className="space-y-3">
        {ROW_ORDER.map(({ key, label }) => (
          <SeoRow key={key} label={label} signal={extras[key]} />
        ))}
      </ul>
    </div>
  );
}

function SummaryDot({
  status,
  count,
}: {
  status: GaugeStatus;
  count: number;
}) {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
      <span className="tabular-nums">{count}</span>
    </span>
  );
}

function SeoRow({ label, signal }: { label: string; signal: GaugeSignal }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className={`mt-1 h-2 w-2 flex-none rounded-full ${STATUS_DOT[signal.status]}`}
      />
      <div className="flex-1 space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-foreground">{label}</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_BADGE[signal.status]}`}
          >
            {signal.status}
          </span>
        </div>
        <p className="text-xs text-text-muted">{signal.label}</p>
        {signal.target && signal.value != null && signal.status !== "skipped" ? (
          <GaugeBar value={signal.value} target={signal.target} status={signal.status} />
        ) : null}
        {signal.detail ? (
          <p className="text-[11px] text-text-muted/80">{signal.detail}</p>
        ) : null}
      </div>
    </li>
  );
}

function GaugeBar({
  value,
  target,
  status,
}: {
  value: number;
  target: { min?: number; max?: number; ideal?: number };
  status: GaugeStatus;
}) {
  const upper = target.max ?? target.ideal ?? Math.max(value, 1);
  const scale = Math.max(upper * 1.5, value, 1);
  const pct = Math.min(100, (value / scale) * 100);
  const idealPct = target.ideal ? Math.min(100, (target.ideal / scale) * 100) : null;
  const minPct = target.min ? Math.min(100, (target.min / scale) * 100) : null;
  const maxPct = target.max ? Math.min(100, (target.max / scale) * 100) : null;

  return (
    <div className="relative h-1.5 w-full rounded-full bg-sidebar">
      {/* target band */}
      {minPct != null && maxPct != null ? (
        <div
          aria-hidden
          className="absolute inset-y-0 rounded-full bg-status-teal/15"
          style={{ left: `${minPct}%`, width: `${maxPct - minPct}%` }}
        />
      ) : null}
      {/* current value */}
      <div
        className={`absolute inset-y-0 left-0 rounded-full ${STATUS_DOT[status]}`}
        style={{ width: `${pct}%`, opacity: 0.85 }}
      />
      {/* ideal marker */}
      {idealPct != null ? (
        <span
          aria-hidden
          className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-foreground/60"
          style={{ left: `${idealPct}%` }}
        />
      ) : null}
    </div>
  );
}
