"use client";

// Portaled custom select. Replaces native <select> for the dropdowns
// inside the upload modal because:
//   1. macOS Chrome misrenders native select popups inside flex
//      overflow:auto containers (anchors at wrong coordinates)
//   2. Custom-rendered absolute menus get clipped by the modal's
//      overflow:hidden on max-h-[90vh]
//
// Fix: render the menu via createPortal into document.body with
// position:fixed coordinates derived from the trigger's bounding
// rect. The menu lives above every clipping context, never gets
// cut off, and re-positions on scroll/resize.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface MenuOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (next: string) => void;
  options: MenuOption[];
  placeholder?: string;
  /** Render an extra row at the bottom (used for "+ Create new type…"). */
  extra?: { value: string; label: string };
  /** Visual size — "sm" matches the bulk-apply panel; default matches
   * the main form field height. */
  size?: "sm" | "md";
  className?: string;
  /** Override the trigger classes. Replaces the size-based padding +
   * radius — pass full class set when using this. */
  triggerClassName?: string;
  id?: string;
  disabled?: boolean;
}

interface MenuPosition {
  /** Used when the menu opens DOWNWARD (top edge anchored). */
  top?: number;
  /** Used when the menu opens UPWARD — distance from viewport
   * bottom to the menu's bottom edge. Pinning the bottom keeps
   * the menu visually adjacent to the trigger no matter the
   * content height. */
  bottom?: number;
  left: number;
  width: number;
  flipped: boolean;
}

const MENU_GAP = 4;
const MENU_MAX_HEIGHT = 256; // 16rem

export function MenuSelect({
  value,
  onChange,
  options,
  placeholder = "—",
  extra,
  size = "md",
  className = "",
  triggerClassName,
  id,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Compute menu position. Runs synchronously with layout to avoid
  // the menu rendering at (0,0) for one frame when first opened.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
      const spaceAbove = rect.top - MENU_GAP;
      // Flip up if there's not enough room below AND there's more
      // room above. Keeps the menu fully visible.
      const flip = spaceBelow < MENU_MAX_HEIGHT && spaceAbove > spaceBelow;
      if (flip) {
        // Pin the menu's BOTTOM to MENU_GAP above the trigger top.
        // This way short menus sit right under the trigger top edge
        // instead of floating high in the viewport.
        setPos({
          bottom: window.innerHeight - rect.top + MENU_GAP,
          left: rect.left,
          width: rect.width,
          flipped: true,
        });
      } else {
        setPos({
          top: rect.bottom + MENU_GAP,
          left: rect.left,
          width: rect.width,
          flipped: false,
        });
      }
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

  // Outside click + Escape close
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

  const selected = options.find((o) => o.value === value);
  // Extra right padding so the chevron sits with breathing room from
  // the trigger's edge, matching the input/select rhythm in the
  // rest of the form.
  const sizeCls =
    size === "sm"
      ? "text-xs pl-2 pr-3 py-1.5 rounded-md"
      : "pl-3 pr-4 py-2 rounded-lg";
  const triggerCls = triggerClassName ?? sizeCls;
  const itemCls =
    size === "sm" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm";

  const menu =
    open && pos
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[100] bg-card border border-border rounded-lg shadow-xl py-1 overflow-y-auto"
            style={{
              ...(pos.flipped
                ? { bottom: pos.bottom }
                : { top: pos.top }),
              left: pos.left,
              width: pos.width,
              maxHeight: MENU_MAX_HEIGHT,
            }}
            // Stop scroll inside the menu from re-positioning the
            // menu itself
            onWheel={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className={`w-full text-left flex items-center gap-2 ${itemCls} hover:bg-gray-100 dark:hover:bg-gray-800 ${
                value === "" ? "text-foreground" : "text-text-muted"
              }`}
            >
              <span className="w-3 flex-shrink-0">
                {value === "" ? <Check size={12} /> : null}
              </span>
              {placeholder}
            </button>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`w-full text-left flex items-center gap-2 ${itemCls} hover:bg-gray-100 dark:hover:bg-gray-800 text-foreground ${
                  value === o.value ? "font-medium" : ""
                }`}
              >
                <span className="w-3 flex-shrink-0">
                  {value === o.value ? <Check size={12} /> : null}
                </span>
                <span className="truncate">{o.label}</span>
              </button>
            ))}
            {extra ? (
              <>
                <div className="border-t border-border my-1" />
                <button
                  type="button"
                  onClick={() => {
                    onChange(extra.value);
                    setOpen(false);
                  }}
                  className={`w-full text-left flex items-center gap-2 ${itemCls} text-primary-600 hover:bg-gray-100 dark:hover:bg-gray-800`}
                >
                  <span className="w-3 flex-shrink-0" />
                  {extra.label}
                </button>
              </>
            ) : null}
          </div>,
          document.body
        )
      : null;

  return (
    <div className={`relative ${className}`}>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`${triggerCls} w-full border bg-card text-left flex items-center justify-between gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          open
            ? "border-primary-400 ring-2 ring-primary-100 dark:ring-primary-900"
            : "border-border hover:border-primary-300"
        } ${selected ? "text-foreground" : "text-text-muted"}`}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={size === "sm" ? 12 : 14}
          className={`text-text-muted transition-transform flex-shrink-0 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {mounted ? menu : null}
    </div>
  );
}
