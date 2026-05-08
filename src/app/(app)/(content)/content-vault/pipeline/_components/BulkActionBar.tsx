"use client";

import { Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  selectedCount: number;
  onClear: () => void;
  onMarkPosted: () => void;
  onDelete: () => void;
  busy?: boolean;
}

export function BulkActionBar({
  selectedCount,
  onClear,
  onMarkPosted,
  onDelete,
  busy,
}: Props) {
  if (selectedCount === 0) return null;
  return (
    <div className="bg-card border border-border rounded-2xl px-4 py-2.5 mb-3 flex items-center gap-3 shadow-sm">
      <button
        type="button"
        onClick={onClear}
        className="p-1 rounded-md text-text-muted hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800"
        aria-label="Clear selection"
      >
        <X size={14} />
      </button>
      <span className="text-sm font-medium text-foreground">
        {selectedCount} selected
      </span>
      <div className="flex items-center gap-2 ml-auto">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onMarkPosted}
          disabled={busy}
        >
          <Send size={14} className="mr-1.5" />
          Mark posted
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onDelete}
          disabled={busy}
          className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
        >
          <Trash2 size={14} className="mr-1.5" />
          Delete
        </Button>
      </div>
    </div>
  );
}
