"use client";

// Static viral growth guide — research-backed X (Twitter) daily targets.
// Based on analysis of fastest-growing Nigerian/Lagos niche accounts.

import { useState } from "react";
import { TrendingUp, ChevronDown, ChevronUp, MessageCircle, Repeat2, FileText, Film } from "lucide-react";

interface DailyTarget {
  icon: React.ReactNode;
  label: string;
  target: string;
  tip: string;
  priority: "high" | "medium" | "low";
}

const DAILY_TARGETS: DailyTarget[] = [
  {
    icon: <FileText size={13} />,
    label: "Original tweets",
    target: "3–5 / day",
    tip: "80% text-only (hooks, opinions, stories). 20% with media. Post at 8–10am, 12–2pm, 7–9pm WAT.",
    priority: "high",
  },
  {
    icon: <MessageCircle size={13} />,
    label: "Strategic replies",
    target: "8–15 / day",
    tip: "Reply to accounts with 5×–50× your followers in your niche. Add a genuine take — not just 'great post!' Replies get shown to the author's entire audience.",
    priority: "high",
  },
  {
    icon: <Repeat2 size={13} />,
    label: "Quote tweets",
    target: "2–3 / day",
    tip: "Find a tweet with 500+ likes in your niche. Add your contrarian or complementary take. Your quote rides their momentum.",
    priority: "high",
  },
  {
    icon: <Film size={13} />,
    label: "Thread (weekly)",
    target: "2–3 / week",
    tip: "Threads get 3–5× more impressions than single tweets. Educational threads ('How we did X') or story threads ('Thread: How we grew to 10k followers'). Post Tuesday–Thursday.",
    priority: "medium",
  },
];

const PRINCIPLES = [
  { title: "Hook in first 2 lines", desc: "90% of readers never click 'see more'. Win them in the first 280 visible chars." },
  { title: "Engage before you broadcast", desc: "Spend 15 min replying before your first post of the day. The algorithm rewards accounts that drive conversations, not just publish." },
  { title: "Volume wins early", desc: "Under 1K followers? Quantity beats perfection. Post more, learn what lands. Quality filter comes at 5K+." },
  { title: "Reply to keyword signals", desc: "Use the X Signals above — those are active conversations in your space RIGHT NOW. Jump in within 2 hours for maximum visibility." },
  { title: "Media = 2× reach", desc: "Photos, short clips, screenshots — tweets with media get ~2× more impressions on X. Not every tweet, but 1–2/day." },
];

const GROWTH_STAGES = [
  { range: "0–500 followers", focus: "Volume + engagement. Reply 20×/day. Build your voice. Don't pitch yet." },
  { range: "500–2K followers", focus: "Start threads. Post original opinions. Your takes matter now. 1 thread/week." },
  { range: "2K–10K followers", focus: "Niche down hard. Quote tweet bigger accounts. Collaborate. Your authority is forming." },
  { range: "10K+", focus: "Broadcast more. Lead conversations. Launch products. Your audience trusts you." },
];

const PRIORITY_COLORS = {
  high: "bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-400",
  medium: "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400",
  low: "bg-white-100 text-gray-600 dark:bg-white/5 dark:text-gray-400",
};

export function GrowthGuide() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-6 rounded-xl border border-border/60 bg-card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-white-600 dark:hover:bg-sidebar/60 transition-colors"
      >
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-success-500" />
          <span className="text-sm font-semibold text-foreground">Growth playbook</span>
          <span className="text-[11px] text-text-muted">— your daily targets to go viral</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            {expanded ? "Hide" : "Show"}
          </span>
          {expanded ? (
            <ChevronUp size={14} className="text-text-muted" />
          ) : (
            <ChevronDown size={14} className="text-text-muted" />
          )}
        </div>
      </button>

      {expanded && (
        <>
          {/* Daily targets */}
          <div className="px-5 pb-4 border-t border-border/60">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted pt-4 pb-3">Daily targets</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {DAILY_TARGETS.map((t) => (
                <div
                  key={t.label}
                  className="rounded-xl border border-border/50 bg-white-600 dark:bg-sidebar/60 p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-foreground">
                      <span className="text-text-muted">{t.icon}</span>
                      <span className="text-sm font-semibold">{t.label}</span>
                    </div>
                    <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${PRIORITY_COLORS[t.priority]}`}>
                      {t.target}
                    </span>
                  </div>
                  <p className="text-[12px] text-text-muted leading-relaxed">{t.tip}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Principles */}
          <div className="px-5 pb-4 border-t border-border/60">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted pt-4 pb-3">Rules that compound</p>
            <div className="space-y-2.5">
              {PRINCIPLES.map((p) => (
                <div key={p.title} className="flex gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary-500 mt-1.5 shrink-0" />
                  <div>
                    <span className="text-[12px] font-semibold text-foreground">{p.title}</span>
                    <span className="text-[12px] text-text-muted"> — {p.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Growth stages */}
          <div className="px-5 pb-5 border-t border-border/60">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted pt-4 pb-3">Where you are → what to focus on</p>
            <div className="space-y-2">
              {GROWTH_STAGES.map((s) => (
                <div key={s.range} className="flex gap-3 text-[12px]">
                  <span className="shrink-0 font-semibold text-primary-500 w-28">{s.range}</span>
                  <span className="text-text-muted">{s.focus}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
