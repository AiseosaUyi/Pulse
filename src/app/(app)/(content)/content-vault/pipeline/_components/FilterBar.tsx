"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ContentItemStatus,
  ContentType,
} from "@/lib/types/content-pipeline";
import { MenuSelect } from "./MenuSelect";

const STATUS_OPTIONS: Array<{ value: ContentItemStatus; label: string }> = [
  { value: "not_posted", label: "Not posted" },
  { value: "scheduled", label: "Scheduled" },
  { value: "posted", label: "Posted" },
  { value: "archived", label: "Archived" },
  { value: "draft", label: "Draft" },
];

interface Props {
  contentTypes: ContentType[];
}

export function FilterBar({ contentTypes }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);

  const statusValue = params?.get("status") ?? "";
  const typeValue = params?.get("type") ?? "";
  const activeCount = (statusValue ? 1 : 0) + (typeValue ? 1 : 0);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params?.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("cursor");
    startTransition(() => {
      router.push(`?${next.toString()}`);
    });
  };

  const clearAll = () => {
    const next = new URLSearchParams(params?.toString());
    next.delete("status");
    next.delete("type");
    next.delete("cursor");
    startTransition(() => {
      router.push(`?${next.toString()}`);
    });
  };

  // Lock body scroll while the sheet is open so the page behind
  // doesn't scroll under the user's finger.
  useEffect(() => {
    if (!sheetOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen]);

  const filterTriggerCls = "h-10 md:h-11 pl-4 pr-3 text-sm rounded-full";

  return (
    <>
      {/* Desktop — inline pickers */}
      <div className="hidden md:flex items-center gap-2">
        <div className="w-[150px]">
          <MenuSelect
            value={statusValue}
            onChange={(v) => setParam("status", v)}
            options={STATUS_OPTIONS}
            placeholder="All statuses"
            triggerClassName={filterTriggerCls}
          />
        </div>
        <div className="w-[150px]">
          <MenuSelect
            value={typeValue}
            onChange={(v) => setParam("type", v)}
            options={contentTypes.map((t) => ({
              value: t.slug,
              label: t.label,
            }))}
            placeholder="All types"
            triggerClassName={filterTriggerCls}
          />
        </div>
      </div>

      {/* Mobile — single filter icon, opens bottom sheet. Active
       * filter count surfaces as a numbered chip on the icon so the
       * user always knows there's something active behind it. */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="md:hidden relative inline-flex items-center justify-center h-10 w-10 rounded-full border border-border bg-card text-foreground hover:bg-gray-50 dark:hover:bg-gray-900"
        aria-label="Filters"
      >
        <SlidersHorizontal size={16} />
        {activeCount > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-primary-500 text-white text-[10px] font-semibold tabular-nums">
            {activeCount}
          </span>
        ) : null}
      </button>

      {sheetOpen ? (
        <div className="md:hidden fixed inset-0 z-50 flex items-end">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setSheetOpen(false)}
            aria-hidden
          />
          <div className="relative w-full bg-card rounded-t-2xl border-t border-border shadow-2xl pb-[env(safe-area-inset-bottom)] animate-in slide-in-from-bottom duration-200">
            <div className="flex items-center justify-center pt-2.5 pb-1">
              <span className="block w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-700" />
            </div>
            <div className="flex items-center justify-between px-5 pt-1 pb-3">
              <h3 className="text-base font-semibold text-foreground">
                Filters
              </h3>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="p-1 rounded-md text-text-muted hover:text-foreground"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-5 space-y-4 pb-2">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">
                  Status
                </label>
                <MenuSelect
                  value={statusValue}
                  onChange={(v) => setParam("status", v)}
                  options={STATUS_OPTIONS}
                  placeholder="All statuses"
                  triggerClassName="h-11 pl-4 pr-3 text-sm rounded-full w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1.5">
                  Type
                </label>
                <MenuSelect
                  value={typeValue}
                  onChange={(v) => setParam("type", v)}
                  options={contentTypes.map((t) => ({
                    value: t.slug,
                    label: t.label,
                  }))}
                  placeholder="All types"
                  triggerClassName="h-11 pl-4 pr-3 text-sm rounded-full w-full"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-5 border-t border-border mt-2">
              <Button
                type="button"
                variant="tertiary"
                size="sm"
                onClick={clearAll}
                disabled={activeCount === 0}
              >
                Clear all
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setSheetOpen(false)}
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
