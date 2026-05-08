"use client";

// Lightweight global toast system. One `<Toaster />` mounts in the
// app layout; any client component can call `toast.success()` /
// `toast.error()` / `toast.info()` to surface a transient banner
// in the bottom-right. No external deps; small in-memory pub/sub
// keeps the API tree-shakeable and test-friendly.
//
// Usage:
//   import { toast } from "@/components/ui/Toaster";
//   toast.success("Deleted");
//   toast.error("Couldn't save", "Try again");

import {
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export type ToastTone = "success" | "error" | "info";

interface ToastEntry {
  id: number;
  tone: ToastTone;
  title: string;
  subtitle?: string;
}

type Listener = (entry: ToastEntry) => void;
const listeners = new Set<Listener>();
let nextId = 1;

function emit(tone: ToastTone, title: string, subtitle?: string) {
  const entry: ToastEntry = { id: nextId++, tone, title, subtitle };
  listeners.forEach((l) => l(entry));
}

export const toast = {
  success(title: string, subtitle?: string) {
    emit("success", title, subtitle);
  },
  error(title: string, subtitle?: string) {
    emit("error", title, subtitle);
  },
  info(title: string, subtitle?: string) {
    emit("info", title, subtitle);
  },
};

const TONE_CLASSES: Record<ToastTone, string> = {
  success:
    "bg-emerald-50 text-emerald-900 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-100 dark:border-emerald-900",
  error:
    "bg-red-50 text-red-900 border-red-200 dark:bg-red-950/60 dark:text-red-100 dark:border-red-900",
  info:
    "bg-card text-foreground border-border",
};

const ICONS: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 size={16} className="text-emerald-600" />,
  error: <AlertCircle size={16} className="text-red-600" />,
  info: <Info size={16} className="text-text-muted" />,
};

const AUTO_DISMISS_MS = 3500;

export function Toaster() {
  const [items, setItems] = useState<ToastEntry[]>([]);

  useEffect(() => {
    const onEntry: Listener = (entry) => {
      setItems((prev) => [...prev, entry]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((i) => i.id !== entry.id));
      }, AUTO_DISMISS_MS);
    };
    listeners.add(onEntry);
    return () => {
      listeners.delete(onEntry);
    };
  }, []);

  const dismiss = (id: number) =>
    setItems((prev) => prev.filter((i) => i.id !== id));

  if (items.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border shadow-md min-w-[260px] max-w-[420px] ${TONE_CLASSES[t.tone]}`}
        >
          <span className="flex-shrink-0 mt-0.5">{ICONS[t.tone]}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{t.title}</div>
            {t.subtitle ? (
              <div className="text-xs opacity-80 mt-0.5">{t.subtitle}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="flex-shrink-0 p-0.5 rounded-md opacity-60 hover:opacity-100"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
