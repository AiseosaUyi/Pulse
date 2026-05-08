"use client";

// Inline type changer for the table cell. Renders the current
// type label as a small clickable button; clicking opens a
// portaled menu (no clipping). Same posture as the StatusPill
// but neutral styling.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { useDialogs } from "@/components/ui/Dialog";
import { updateContentItem } from "@/lib/actions/content-pipeline";
import type { ContentType } from "@/lib/types/content-pipeline";

const MENU_GAP = 4;
const MENU_MAX_HEIGHT = 240;
const MIN_WIDTH = 160;

export function InlineTypePicker({
  itemId,
  value,
  label,
  contentTypes,
}: {
  itemId: string;
  value: string | null;
  label: string | null;
  contentTypes: ContentType[];
}) {
  const dialogs = useDialogs();
  const [open, setOpen] = useState(false);
  const [localValue, setLocalValue] = useState(value);
  const [localLabel, setLocalLabel] = useState(label);
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
  useEffect(() => {
    setLocalValue(value);
    setLocalLabel(label);
  }, [value, label]);

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
              minWidth: Math.max(rect.width, MIN_WIDTH),
            }
          : {
              top: rect.bottom + MENU_GAP,
              left: rect.left,
              minWidth: Math.max(rect.width, MIN_WIDTH),
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

  const change = (slug: string | null, nextLabel: string | null) => {
    setOpen(false);
    if (slug === localValue) return;
    const prevValue = localValue;
    const prevLabel = localLabel;
    setLocalValue(slug);
    setLocalLabel(nextLabel);
    startTransition(async () => {
      const res = await updateContentItem({
        id: itemId,
        contentTypeSlug: slug,
      });
      if (!res.ok) {
        setLocalValue(prevValue);
        setLocalLabel(prevLabel);
        await dialogs.alert({
          title: "Couldn't change type",
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
            className="fixed z-[100] bg-card border border-border rounded-lg shadow-xl py-1 overflow-y-auto"
            style={{
              ...(pos.top !== undefined
                ? { top: pos.top }
                : { bottom: pos.bottom }),
              left: pos.left,
              minWidth: pos.minWidth,
              maxHeight: MENU_MAX_HEIGHT,
            }}
          >
            <button
              type="button"
              onClick={() => change(null, null)}
              className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 ${
                localValue === null ? "text-foreground" : "text-text-muted"
              }`}
            >
              <span className="w-3 flex-shrink-0">
                {localValue === null ? <Check size={12} /> : null}
              </span>
              —
            </button>
            {contentTypes.map((t) => (
              <button
                key={t.slug}
                type="button"
                onClick={() => change(t.slug, t.label)}
                className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 text-foreground ${
                  localValue === t.slug ? "font-medium" : ""
                }`}
              >
                <span className="w-3 flex-shrink-0">
                  {localValue === t.slug ? <Check size={12} /> : null}
                </span>
                <span className="truncate">{t.label}</span>
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
        className="inline-flex items-center gap-1 text-xs text-foreground hover:text-primary-600 px-1.5 py-0.5 rounded -mx-1.5"
      >
        {localLabel ?? <span className="text-text-muted">Not set</span>}
        <ChevronDown size={12} className="text-text-muted opacity-60" />
      </button>
      {mounted ? menu : null}
    </>
  );
}
