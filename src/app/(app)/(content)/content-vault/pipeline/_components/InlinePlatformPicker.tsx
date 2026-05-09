"use client";

// Inline platform editor for the table cell. Shows the current
// platform badges; clicking opens a portaled popover with a multi-
// select list. Mirrors the portaled-popover pattern from the other
// inline pickers so the menu is never clipped by the table's
// overflow-x.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { Check, Plus } from "lucide-react";
import { useDialogs } from "@/components/ui/Dialog";
import { updateContentItem } from "@/lib/actions/content-pipeline";
import type { ContentPlatform } from "@/lib/types/content-pipeline";
import { PlatformBadges } from "./PlatformBadges";

const POPOVER_GAP = 4;
const POPOVER_WIDTH = 240;
const POPOVER_MAX_HEIGHT = 320;

const ALL_PLATFORMS: { value: ContentPlatform; label: string }[] = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
  { value: "facebook", label: "Facebook" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
];

export function InlinePlatformPicker({
  itemId,
  platforms,
}: {
  itemId: string;
  platforms: ContentPlatform[];
}) {
  const dialogs = useDialogs();
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<ContentPlatform[]>(platforms);
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
    setLocal(platforms);
  }, [platforms]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - POPOVER_GAP;
      const spaceAbove = rect.top - POPOVER_GAP;
      const flip =
        spaceBelow < POPOVER_MAX_HEIGHT && spaceAbove > spaceBelow;
      const left = Math.min(
        rect.left,
        window.innerWidth - POPOVER_WIDTH - 8
      );
      setPos(
        flip
          ? {
              bottom: window.innerHeight - rect.top + POPOVER_GAP,
              left: Math.max(8, left),
            }
          : {
              top: rect.bottom + POPOVER_GAP,
              left: Math.max(8, left),
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
      // Persist when the popover is dismissed by clicking away.
      flushIfChanged();
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        flushIfChanged();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, local]);

  const sameSet = (a: ContentPlatform[], b: ContentPlatform[]) => {
    if (a.length !== b.length) return false;
    const sa = new Set(a);
    return b.every((x) => sa.has(x));
  };

  const flushIfChanged = () => {
    if (sameSet(local, platforms)) return;
    const prev = platforms;
    const next = local;
    startTransition(async () => {
      const res = await updateContentItem({ id: itemId, platforms: next });
      if (!res.ok) {
        setLocal(prev);
        await dialogs.alert({
          title: "Couldn't update platforms",
          subtitle: res.error,
        });
      }
    });
  };

  const toggle = (p: ContentPlatform) => {
    setLocal((cur) =>
      cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]
    );
  };

  const popover =
    open && pos
      ? createPortal(
          <div
            ref={popRef}
            className="fixed z-[100] bg-card border border-border rounded-xl shadow-xl py-1 overflow-y-auto"
            style={{
              ...(pos.top !== undefined
                ? { top: pos.top }
                : { bottom: pos.bottom }),
              left: pos.left,
              width: POPOVER_WIDTH,
              maxHeight: POPOVER_MAX_HEIGHT,
            }}
          >
            <p className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-text-muted">
              Post on
            </p>
            {ALL_PLATFORMS.map((p) => {
              const selected = local.includes(p.value);
              return (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => toggle(p.value)}
                  className={`w-full text-left flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 ${
                    selected ? "text-foreground font-medium" : "text-foreground"
                  }`}
                >
                  <PlatformBadges platforms={[p.value]} />
                  <span className="truncate flex-1">{p.label}</span>
                  {selected ? (
                    <Check size={12} className="text-primary-500 flex-shrink-0" />
                  ) : null}
                </button>
              );
            })}
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
        aria-label="Edit platforms"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 -mx-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors min-h-7"
      >
        {local.length > 0 ? (
          <PlatformBadges platforms={local} />
        ) : (
          <span className="inline-flex items-center gap-1 text-text-muted text-xs">
            <Plus size={12} />
            Add
          </span>
        )}
      </button>
      {mounted ? popover : null}
    </>
  );
}
