"use client";

// Status pill with a portaled dropdown menu so it's never clipped
// by the table's overflow-x. When the user picks "Posted", a URL
// prompt fires and markPosted() runs server-side; other statuses
// just call updateContentItem with the new value. Supports an
// optional onChange callback for parents that need to reflect the
// new state immediately.

import { useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { useDialogs } from "@/components/ui/Dialog";
import {
  markPosted,
  updateContentItem,
} from "@/lib/actions/content-pipeline";
import type { ContentItemStatus } from "@/lib/types/content-pipeline";

const STATUS_LABELS: Record<ContentItemStatus, string> = {
  not_posted: "Not posted",
  scheduled: "Scheduled",
  posted: "Posted",
  archived: "Archived",
  draft: "Draft",
};

// Subtle Gruve-aligned tints — soft surfaces, no in-app gradients.
const STATUS_CLASSES: Record<ContentItemStatus, string> = {
  not_posted:
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200",
  scheduled:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  posted:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
  archived: "bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-500",
  draft: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
};

const STATUS_ORDER: ContentItemStatus[] = [
  "not_posted",
  "scheduled",
  "posted",
  "archived",
  "draft",
];

const MENU_GAP = 4;
const MENU_MAX_HEIGHT = 240;

export function StatusPill({
  itemId,
  status,
  onChange,
}: {
  itemId: string;
  status: ContentItemStatus;
  onChange?: (next: ContentItemStatus) => void;
}) {
  const dialogs = useDialogs();
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(status);
  const [, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    minWidth: number;
  } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => setLocal(status), [status]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
      const spaceAbove = rect.top - MENU_GAP;
      const flip =
        spaceBelow < MENU_MAX_HEIGHT && spaceAbove > spaceBelow;
      setPos(
        flip
          ? {
              bottom: window.innerHeight - rect.top + MENU_GAP,
              left: rect.left,
              minWidth: Math.max(rect.width, 140),
            }
          : {
              top: rect.bottom + MENU_GAP,
              left: rect.left,
              minWidth: Math.max(rect.width, 140),
            }
      );
    };
    place();
    const onResize = () => place();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const change = async (next: ContentItemStatus) => {
    setOpen(false);
    if (next === local) return;
    const prev = local;
    setLocal(next);
    onChange?.(next);
    startTransition(async () => {
      // "Posted" stamps posted_at via markPosted; other transitions
      // are plain status updates. Posted URL is optional and not
      // collected here — users can edit it later via Edit modal.
      const res =
        next === "posted"
          ? await markPosted(itemId)
          : await updateContentItem({ id: itemId, status: next });
      if (!res.ok) {
        setLocal(prev);
        onChange?.(prev);
        await dialogs.alert({
          title: "Couldn't update status",
          subtitle: res.error,
        });
      }
    });
  };

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[100] bg-card border border-border rounded-lg shadow-xl py-1"
            style={{
              ...(pos.top !== undefined
                ? { top: pos.top }
                : { bottom: pos.bottom }),
              left: pos.left,
              minWidth: pos.minWidth,
            }}
          >
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => change(s)}
                className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 ${
                  s === local
                    ? "text-foreground font-medium"
                    : "text-foreground"
                }`}
              >
                <span className="w-3 flex-shrink-0">
                  {s === local ? <Check size={12} /> : null}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_CLASSES[s]}`}
                >
                  {STATUS_LABELS[s]}
                </span>
              </button>
            ))}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_CLASSES[local]}`}
      >
        {STATUS_LABELS[local]}
        <ChevronDown size={12} className="flex-shrink-0" />
      </button>
      {mounted ? menu : null}
    </>
  );
}
