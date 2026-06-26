"use client";

// Inline schedule editor for the table cell. Shows the current
// scheduled date (or a calendar icon + "Set"); clicking opens a
// portaled popover with a native datetime-local input + Save/Clear.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { APP_TIME_ZONE } from "@/lib/utils/format";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDialogs } from "@/components/ui/Dialog";
import { updateContentItem } from "@/lib/actions/content-pipeline";

const POPOVER_GAP = 6;
const POPOVER_WIDTH = 260;

function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: APP_TIME_ZONE,
    month: "short",
    day: "numeric",
  });
}

export function InlineSchedulePicker({
  itemId,
  scheduledAt,
}: {
  itemId: string;
  scheduledAt: string | null;
}) {
  const dialogs = useDialogs();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(isoToLocalInput(scheduledAt));
  const [local, setLocal] = useState(scheduledAt);
  const [, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
  } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    setLocal(scheduledAt);
    setValue(isoToLocalInput(scheduledAt));
  }, [scheduledAt]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - POPOVER_GAP;
      const flip = spaceBelow < 200;
      setPos(
        flip
          ? {
              bottom: window.innerHeight - rect.top + POPOVER_GAP,
              left: Math.max(8, rect.left),
            }
          : {
              top: rect.bottom + POPOVER_GAP,
              left: Math.max(8, rect.left),
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
      if (popRef.current?.contains(t)) return;
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

  // Auto-saves on every change. Browser fires the change event when
  // the user picks a date in the native picker; we persist
  // immediately so closing the popover (click-out) just dismisses
  // the UI, not a pending save.
  const persist = (nextValue: string) => {
    const next = nextValue ? new Date(nextValue).toISOString() : null;
    if (next === local) return;
    const prev = local;
    setLocal(next);
    startTransition(async () => {
      const res = await updateContentItem({
        id: itemId,
        scheduledAt: next,
      });
      if (!res.ok) {
        setLocal(prev);
        setValue(isoToLocalInput(prev));
        await dialogs.alert({
          title: "Couldn't update schedule",
          subtitle: res.error,
        });
      }
    });
  };

  const onChangeValue = (next: string) => {
    setValue(next);
    persist(next);
  };

  const clear = () => {
    setValue("");
    persist("");
  };

  const popover =
    open && pos
      ? createPortal(
          <div
            ref={popRef}
            className="fixed z-[100] bg-card border border-border rounded-xl shadow-xl p-3"
            style={{
              ...(pos.top !== undefined
                ? { top: pos.top }
                : { bottom: pos.bottom }),
              left: pos.left,
              width: POPOVER_WIDTH,
            }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-foreground">
                Post schedule
              </span>
              {local ? (
                <button
                  type="button"
                  onClick={clear}
                  className="text-xs text-text-muted hover:text-red-600"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <Input
              type="datetime-local"
              value={value}
              onChange={(e) => onChangeValue(e.target.value)}
              className="[&::-webkit-calendar-picker-indicator]:cursor-pointer"
              autoFocus
            />
            <p className="text-[10px] text-text-muted mt-1.5">
              Saves automatically.
            </p>
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
        aria-label={local ? `Scheduled ${formatDate(local)}` : "Set schedule"}
        className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-foreground px-1.5 py-0.5 rounded -mx-1.5"
      >
        <CalendarDays size={13} className="flex-shrink-0" />
        {local ? <span>{formatDate(local)}</span> : null}
      </button>
      {mounted ? popover : null}
    </>
  );
}
