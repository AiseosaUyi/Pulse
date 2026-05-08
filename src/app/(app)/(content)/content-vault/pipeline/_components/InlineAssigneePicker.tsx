"use client";

// Inline assignee editor for the table cell. Shows a clickable user
// icon when unassigned, or an avatar + first name when assigned.
// Clicking opens a portaled popover with a member list. Mirrors the
// portaled-popover pattern used by StatusPill and InlineSchedulePicker
// so the menu is never clipped by the table's overflow-x.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import { Check, User, X } from "lucide-react";
import { useDialogs } from "@/components/ui/Dialog";
import { updateContentItem } from "@/lib/actions/content-pipeline";

const POPOVER_GAP = 4;
const POPOVER_WIDTH = 240;
const POPOVER_MAX_HEIGHT = 280;

export function InlineAssigneePicker({
  itemId,
  assignedTo,
  assignedToFirstName,
  assignedToAvatarUrl,
  members,
}: {
  itemId: string;
  assignedTo: string | null;
  assignedToFirstName: string | null;
  assignedToAvatarUrl: string | null;
  members: Array<{ id: string; name: string; avatarUrl?: string | null }>;
}) {
  const dialogs = useDialogs();
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState({
    id: assignedTo,
    name: assignedToFirstName,
    avatar: assignedToAvatarUrl,
  });
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
    setLocal({
      id: assignedTo,
      name: assignedToFirstName,
      avatar: assignedToAvatarUrl,
    });
  }, [assignedTo, assignedToFirstName, assignedToAvatarUrl]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - POPOVER_GAP;
      const spaceAbove = rect.top - POPOVER_GAP;
      const flip =
        spaceBelow < POPOVER_MAX_HEIGHT && spaceAbove > spaceBelow;
      // Right-align if the menu would overflow the viewport edge.
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

  const persist = (nextId: string | null) => {
    setOpen(false);
    if (nextId === local.id) return;
    const prev = local;
    const member = nextId ? members.find((m) => m.id === nextId) : null;
    setLocal({
      id: nextId,
      name: member ? member.name.split(" ")[0] : null,
      avatar: member?.avatarUrl ?? null,
    });
    startTransition(async () => {
      const res = await updateContentItem({
        id: itemId,
        assignedTo: nextId,
      });
      if (!res.ok) {
        setLocal(prev);
        await dialogs.alert({
          title: "Couldn't update assignee",
          subtitle: res.error,
        });
      }
    });
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
            {/* Unassign — only shown when something is currently set */}
            {local.id ? (
              <>
                <button
                  type="button"
                  onClick={() => persist(null)}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-xs text-text-muted hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <span className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                    <X size={12} />
                  </span>
                  Unassign
                </button>
                <div className="my-1 border-t border-border" />
              </>
            ) : null}

            {members.length === 0 ? (
              <p className="px-3 py-3 text-xs text-text-muted">
                No teammates yet.
              </p>
            ) : (
              members.map((m) => {
                const selected = m.id === local.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => persist(m.id)}
                    className={`w-full text-left flex items-center gap-2 px-3 py-2 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 ${
                      selected ? "text-foreground font-medium" : "text-foreground"
                    }`}
                  >
                    {m.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.avatarUrl}
                        alt=""
                        className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <span className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                        <User size={12} className="text-text-muted" />
                      </span>
                    )}
                    <span className="truncate flex-1">{m.name}</span>
                    {selected ? (
                      <Check size={12} className="text-primary-500 flex-shrink-0" />
                    ) : null}
                  </button>
                );
              })
            )}
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
        aria-label={local.name ? `Assigned to ${local.name}` : "Assign"}
        className="inline-flex items-center gap-2 rounded-md px-1.5 py-0.5 -mx-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        {local.id ? (
          <>
            {local.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={local.avatar}
                alt=""
                className="w-6 h-6 rounded-full object-cover"
              />
            ) : (
              <span className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                <User size={12} className="text-text-muted" />
              </span>
            )}
            <span className="text-foreground text-sm whitespace-nowrap">
              {local.name ?? "—"}
            </span>
          </>
        ) : (
          <span className="w-7 h-7 rounded-full border border-border bg-transparent flex items-center justify-center text-text-muted hover:text-foreground hover:border-foreground transition-colors">
            <User size={14} />
          </span>
        )}
      </button>
      {mounted ? popover : null}
    </>
  );
}
