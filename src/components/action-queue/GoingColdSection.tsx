"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/Toaster";
import type { QueueRow } from "@/lib/services/action-queue";
import { SimpleGrid } from "@/components/ui/SimpleGrid";
import { GoingColdChip } from "./GoingColdChip";
import { logRowActivity, draftFinalAttempts } from "@/lib/actions/action-queue";

// No collapse — always visible, capped at a fixed height by the caller
// (ActionQueueBoard) so 20 names never blow out the page; you scroll
// inside instead of clicking to reveal.
export function GoingColdSection({ rows, onChanged }: { rows: QueueRow[]; onChanged: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  if (rows.length === 0) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function draftSelected() {
    const prospectIds = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
    startTransition(async () => {
      const res = await draftFinalAttempts(prospectIds);
      if (!res.success) {
        toast.error("Couldn't draft", res.error);
        return;
      }
      toast.success(
        `Drafted ${res.drafted} final attempt${res.drafted === 1 ? "" : "s"}`,
        res.failed > 0 ? `${res.failed} failed` : undefined
      );
      setSelected(new Set());
      onChanged();
    });
  }

  return (
    <div className="space-y-2">
      <SimpleGrid cols={2} colsMd={3} colsLg={4} gap={2}>
        {rows.map((row) => (
          <GoingColdChip
            key={row.id}
            row={row}
            selected={selected.has(row.id)}
            onToggle={() => toggle(row.id)}
            onOpen={() => startTransition(() => logRowActivity({ source: row.source, id: row.id }, "opened", row.title))}
          />
        ))}
      </SimpleGrid>
      {selected.size > 0 && (
        <div className="flex justify-end">
          <Button size="xs" onClick={draftSelected}>
            Draft final attempt for {selected.size} selected
          </Button>
        </div>
      )}
    </div>
  );
}
