"use client";

// Per-row 3-dot menu. Portaled to escape the table's overflow-x.
// Items: Edit, Mark posted, Delete. Mark posted runs the same flow
// as the StatusPill's Posted choice. Delete shows a confirmation.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Edit3, MoreHorizontal, Send, Trash2 } from "lucide-react";

interface Props {
  onEdit: () => void;
  onMarkPosted: () => void;
  onDelete: () => void;
  isPosted: boolean;
}

const MENU_GAP = 4;
const MENU_WIDTH = 168;

export function RowActionsMenu({
  onEdit,
  onMarkPosted,
  onDelete,
  isPosted,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      // Anchor menu's right edge to the trigger's right edge so the
      // menu opens to the LEFT of the 3-dots (which sit at the row's
      // far right and have no room on the right).
      setPos({
        top: rect.bottom + MENU_GAP,
        left: Math.max(8, rect.right - MENU_WIDTH),
      });
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

  const itemCls =
    "w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800";

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[100] bg-card border border-border rounded-lg shadow-xl py-1"
            style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
          >
            <button
              type="button"
              className={`${itemCls} text-foreground`}
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
            >
              <Edit3 size={14} className="text-text-muted" />
              Edit
            </button>
            {!isPosted ? (
              <button
                type="button"
                className={`${itemCls} text-foreground`}
                onClick={() => {
                  setOpen(false);
                  onMarkPosted();
                }}
              >
                <Send size={14} className="text-text-muted" />
                Mark as posted
              </button>
            ) : null}
            <div className="border-t border-border my-1" />
            <button
              type="button"
              className={`${itemCls} text-red-600`}
              onClick={() => {
                setOpen(false);
                onDelete();
              }}
            >
              <Trash2 size={14} />
              Delete
            </button>
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
        className="p-1.5 rounded-md text-text-muted hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-800"
        aria-label="Row actions"
      >
        <MoreHorizontal size={16} />
      </button>
      {mounted ? menu : null}
    </>
  );
}
