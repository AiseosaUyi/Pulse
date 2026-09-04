"use client";

// The Action Queue — the body of /dashboard. Density is inverse to the
// work a row demands (compose/card/line/chip variants), and every region
// is a FIXED-HEIGHT scroll box rather than a collapsible dropdown — so a
// long "Needs a reply" list and a short "Needs a decision" list never
// leave one column ragged with whitespace under the other; you scroll
// inside the box instead. On mobile the two-column split doesn't fit, so
// it becomes a tab switcher instead — each tab still carries its own
// count, so nothing is silently hidden the way a click-to-reveal would.
// Polls /api/action-queue every 20s, same cadence/shape as
// ConversationsInbox.tsx's list poll.

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/lib/hooks/useMediaQuery";
import type { ListActionQueueResult, QueueGroupKey, QueueRow } from "@/lib/services/action-queue";
import { QueueGroup } from "./QueueGroup";
import { GoingColdSection } from "./GoingColdSection";
import { SectionHeader } from "./SectionHeader";
import { QueueFilters, type QueueFilterState } from "./QueueFilters";
import type { QueueRowVariant } from "./QueueRowCard";

const POLL_MS = 20000;
// Matches both split columns so left/right never end up visually uneven —
// and caps the lower-priority full-width sections to a small "peek" height
// instead of hiding them behind a click.
const PRIMARY_MAX_H = "560px";
const SECONDARY_MAX_H = "240px";

// "chores" isn't a real service group (QueueGroupKey) — it's a
// display-only split of "needs_decision" (see the filter below) that
// exists only in this component's local layout, never sent to the API.
type BoardSectionKey = QueueGroupKey | "chores";

interface Section {
  key: BoardSectionKey;
  label: string;
  rows: QueueRow[];
  variant: QueueRowVariant;
  cols: 1 | 2 | 3 | 4;
  colsMd?: 1 | 2 | 3 | 4;
}

function rowsFor(result: ListActionQueueResult, key: QueueGroupKey): QueueRow[] {
  return result.groups.find((g) => g.key === key)?.rows ?? [];
}

export function ActionQueueBoard({
  initial,
  canSeeActivity,
  visibleGroups,
}: {
  initial: ListActionQueueResult;
  /** Owner/admin only — gates the per-row Activity log affordance. */
  canSeeActivity: boolean;
  /** Role gating (support): restrict which groups render. Undefined = all. */
  visibleGroups?: QueueGroupKey[];
}) {
  const [result, setResult] = useState(initial);
  const [filter, setFilter] = useState<QueueFilterState>({ platform: "", kind: "" });
  const [showResolved, setShowResolved] = useState(false);
  const [activeTab, setActiveTab] = useState<BoardSectionKey | null>(null);
  const isMobile = !useMediaQuery("(min-width: 768px)");

  const fetchQueue = useCallback(
    async (silent: boolean) => {
      const params = new URLSearchParams();
      if (!silent && showResolved) params.set("status", "resolved");
      if (filter.platform) params.set("platform", filter.platform);
      if (filter.kind) params.set("kind", filter.kind);

      try {
        const res = await fetch(`/api/action-queue?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as ListActionQueueResult;
        setResult(data);
      } catch {
        // Best-effort — keep showing the last good state.
      }
    },
    [filter, showResolved]
  );

  useEffect(() => {
    fetchQueue(false);
  }, [fetchQueue]);

  useEffect(() => {
    if (showResolved) return;
    const iv = setInterval(() => fetchQueue(true), POLL_MS);
    return () => clearInterval(iv);
  }, [fetchQueue, showResolved]);

  const onChanged = () => fetchQueue(true);
  const show = (key: QueueGroupKey) => !visibleGroups || visibleGroups.includes(key);

  const decisionAndChoreRows = show("needs_decision") ? rowsFor(result, "needs_decision") : [];
  // Chores get their own section at the bottom, not mixed into "Needs a
  // decision" — a stack of near-duplicate SEO chores should never outrank
  // a hot lead's question. The service still groups them together (both
  // fold into "needs_decision" per §0.7 of the build plan); the split is a
  // display-layer concern only.
  const decisionRows = decisionAndChoreRows.filter((r) => r.kind !== "chore");
  const choreRows = decisionAndChoreRows.filter((r) => r.kind === "chore");

  const sections: Section[] = useMemo(
    () => [
      { key: "needs_reply", label: "Needs a reply", rows: show("needs_reply") ? rowsFor(result, "needs_reply") : [], variant: "compose", cols: 1 },
      { key: "needs_decision", label: "Needs a decision", rows: decisionRows, variant: "card", cols: 1, colsMd: 2 },
      { key: "follow_ups_due", label: "Follow-ups due", rows: show("follow_ups_due") ? rowsFor(result, "follow_ups_due") : [], variant: "line", cols: 1 },
      { key: "opportunities", label: "Opportunities", rows: show("opportunities") ? rowsFor(result, "opportunities") : [], variant: "card", cols: 1, colsMd: 2 },
      // variant is unused for "going_cold" — it's special-cased to render
      // GoingColdSection instead of QueueGroup wherever it's consumed below.
      { key: "going_cold", label: "Going cold", rows: show("going_cold") ? rowsFor(result, "going_cold") : [], variant: "compose", cols: 1 },
      { key: "chores", label: "Chores", rows: choreRows, variant: "line", cols: 1, colsMd: 2 },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [result, visibleGroups]
  );

  const nonEmptySections = sections.filter((s) => s.rows.length > 0);
  const allEmpty = nonEmptySections.length === 0;
  const activeSection = nonEmptySections.find((s) => s.key === activeTab) ?? nonEmptySections[0];

  if (showResolved) {
    const resolvedRows = result.groups[0]?.rows ?? [];
    return (
      <div className="rounded-2xl border border-border bg-card">
        <BoardHeader showResolved onToggleResolved={() => setShowResolved(false)} />
        <div className="p-5">
          {resolvedRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-secondary">Nothing resolved yet.</p>
          ) : (
            <div className="max-h-[560px] overflow-y-auto pr-1">
              <QueueGroup label="Resolved" rows={resolvedRows} variant="line" canSeeActivity={canSeeActivity} onChanged={onChanged} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card">
      <BoardHeader showResolved={false} onToggleResolved={() => setShowResolved(true)}>
        <QueueFilters value={filter} onChange={setFilter} />
      </BoardHeader>

      <div className="p-5">
        {allEmpty ? (
          <p className="py-8 text-center text-sm text-text-secondary">Nothing needs attention right now.</p>
        ) : isMobile ? (
          <MobileTabs
            sections={nonEmptySections}
            active={activeSection}
            onSelect={setActiveTab}
            canSeeActivity={canSeeActivity}
            onChanged={onChanged}
          />
        ) : (
          <DesktopLayout sections={sections} canSeeActivity={canSeeActivity} onChanged={onChanged} />
        )}
      </div>
    </div>
  );
}

function DesktopLayout({
  sections,
  canSeeActivity,
  onChanged,
}: {
  sections: Section[];
  canSeeActivity: boolean;
  onChanged: () => void;
}) {
  const byKey = (key: BoardSectionKey) => sections.find((s) => s.key === key)!;
  const goingCold = byKey("going_cold");
  const chores = byKey("chores");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 max-h-[560px] overflow-y-auto pr-1" style={{ maxHeight: PRIMARY_MAX_H }}>
          <SectionGroup section={byKey("needs_reply")} canSeeActivity={canSeeActivity} onChanged={onChanged} />
        </div>
        <div className="lg:col-span-5 overflow-y-auto pr-1 space-y-4" style={{ maxHeight: PRIMARY_MAX_H }}>
          <SectionGroup section={byKey("needs_decision")} colsLg={1} canSeeActivity={canSeeActivity} onChanged={onChanged} />
          <SectionGroup section={byKey("follow_ups_due")} canSeeActivity={canSeeActivity} onChanged={onChanged} />
          <SectionGroup section={byKey("opportunities")} colsLg={1} canSeeActivity={canSeeActivity} onChanged={onChanged} />
        </div>
      </div>

      {goingCold.rows.length > 0 && (
        <div>
          <SectionHeader label="Going cold" count={goingCold.rows.length} />
          <div className="overflow-y-auto pr-1" style={{ maxHeight: SECONDARY_MAX_H }}>
            <GoingColdSection rows={goingCold.rows} onChanged={onChanged} />
          </div>
        </div>
      )}

      {chores.rows.length > 0 && (
        <div className="overflow-y-auto pr-1" style={{ maxHeight: SECONDARY_MAX_H }}>
          <SectionGroup section={chores} canSeeActivity={canSeeActivity} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

function MobileTabs({
  sections,
  active,
  onSelect,
  canSeeActivity,
  onChanged,
}: {
  sections: Section[];
  active: Section;
  onSelect: (key: BoardSectionKey) => void;
  canSeeActivity: boolean;
  onChanged: () => void;
}) {
  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
        {sections.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onSelect(s.key)}
            className={cn(
              "shrink-0 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
              active.key === s.key ? "bg-primary-500 text-white" : "bg-border/40 text-text-secondary hover:text-foreground"
            )}
          >
            {s.label} <span className="opacity-70">{s.rows.length}</span>
          </button>
        ))}
      </div>
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {active.key === "going_cold" ? (
          <GoingColdSection rows={active.rows} onChanged={onChanged} />
        ) : (
          <SectionGroup section={active} showHeader={false} canSeeActivity={canSeeActivity} onChanged={onChanged} />
        )}
      </div>
    </div>
  );
}

// A Section object carries a `key` field (for lookup/comparison) that must
// never be spread directly into JSX — React treats a spread-in `key` as an
// error ("React keys must be passed directly to JSX without using spread").
// This unpacks every field explicitly instead.
function SectionGroup({
  section,
  colsLg,
  showHeader,
  canSeeActivity,
  onChanged,
}: {
  section: Section;
  colsLg?: 1 | 2 | 3 | 4;
  showHeader?: boolean;
  canSeeActivity: boolean;
  onChanged: () => void;
}) {
  return (
    <QueueGroup
      label={section.label}
      rows={section.rows}
      variant={section.variant}
      cols={section.cols}
      colsMd={section.colsMd}
      colsLg={colsLg}
      showHeader={showHeader}
      canSeeActivity={canSeeActivity}
      onChanged={onChanged}
    />
  );
}

function BoardHeader({
  showResolved,
  onToggleResolved,
  children,
}: {
  showResolved: boolean;
  onToggleResolved: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 bg-card rounded-t-2xl border-b border-border/50 px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-sm font-semibold text-foreground shrink-0">Action queue</h2>
        {children}
      </div>
      <button type="button" onClick={onToggleResolved} className="text-xs text-primary-500 hover:underline shrink-0">
        {showResolved ? "Back to queue" : "Resolved today"}
      </button>
    </div>
  );
}
