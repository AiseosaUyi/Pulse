import type { QueueRow } from "@/lib/services/action-queue";
import { SimpleGrid } from "@/components/ui/SimpleGrid";
import { QueueRowCard, type QueueRowVariant } from "./QueueRowCard";
import { SectionHeader } from "./SectionHeader";

// No collapse state, no scroll of its own — a plain header + grid. Height/
// scroll is owned by whoever composes this (ActionQueueBoard), since a
// fixed-height region often needs to span several QueueGroups sharing one
// scrollbar (e.g. the whole "Needs a decision" pane), not one per group.
export function QueueGroup({
  label,
  rows,
  variant,
  cols = 1,
  colsMd,
  colsLg,
  canSeeActivity,
  onChanged,
  showHeader = true,
}: {
  label: string;
  rows: QueueRow[];
  variant: QueueRowVariant;
  cols?: 1 | 2 | 3 | 4;
  colsMd?: 1 | 2 | 3 | 4;
  colsLg?: 1 | 2 | 3 | 4;
  canSeeActivity: boolean;
  onChanged: () => void;
  /** false inside the mobile tab panel — the tab itself already carries
   * the label + count, so the group's own header would just repeat it. */
  showHeader?: boolean;
}) {
  // Empty groups render nothing — five "nothing here" panels is the same
  // clutter problem in a different costume (docs/ACTION-QUEUE-LAYOUT.md).
  if (rows.length === 0) return null;

  return (
    <div>
      {showHeader && <SectionHeader label={label} count={rows.length} />}
      <SimpleGrid cols={cols} colsMd={colsMd} colsLg={colsLg} gap={2}>
        {rows.map((row) => (
          <QueueRowCard
            key={`${row.source}:${row.id}`}
            row={row}
            variant={variant}
            canSeeActivity={canSeeActivity}
            onChanged={onChanged}
          />
        ))}
      </SimpleGrid>
    </div>
  );
}
