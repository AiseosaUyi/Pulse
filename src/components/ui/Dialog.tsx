"use client";

// Design-system modal primitives. Replaces every `window.confirm`,
// `window.alert`, and `window.prompt` across the app with branded
// dialogs that have a title, subtitle, an optional illustration, and
// properly styled action buttons.
//
// Three layers:
//
// 1. `<Dialog>` — the low-level shell. Overlay, rounded card, focus
//    trap-lite, ESC close, click-outside close. Use directly for
//    forms that need custom body content (checklist step modals).
//
// 2. `<ConfirmDialog>` — imperative confirm()/alert() replacement
//    driven by the `useConfirm()` hook. Renders itself at the root;
//    callers just `await confirm({ title, ... })`.
//
// 3. `<PromptDialog>` — imperative prompt() replacement with a single
//    text input. Same hook pattern.
//
// Rules:
// - Never block on `window.*` dialogs. They break the Pulse design.
// - Every destructive action gets a red `destructive` tone.
// - Every dialog has an icon/illustration — the tone signals intent
//   before the user reads the copy.

import * as React from "react";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Info,
  CheckCircle2,
  HelpCircle,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type DialogTone = "default" | "destructive" | "warning" | "success" | "info";

export interface DialogHeaderProps {
  title: string;
  subtitle?: string;
  tone?: DialogTone;
  /** Override the default icon for the tone. Pass `null` to suppress. */
  icon?: LucideIcon | null;
}

const TONE_MAP: Record<
  DialogTone,
  { icon: LucideIcon; iconBg: string; iconFg: string }
> = {
  default: {
    icon: HelpCircle,
    iconBg: "bg-primary-500/10",
    iconFg: "text-primary-500",
  },
  destructive: {
    icon: Trash2,
    iconBg: "bg-status-red/10",
    iconFg: "text-status-red",
  },
  warning: {
    icon: AlertTriangle,
    iconBg: "bg-status-yellow/10",
    iconFg: "text-status-yellow",
  },
  success: {
    icon: CheckCircle2,
    iconBg: "bg-status-green/10",
    iconFg: "text-status-green",
  },
  info: {
    icon: Info,
    iconBg: "bg-status-blue/10",
    iconFg: "text-status-blue",
  },
};

// ──────────────────────────────────────────────────────────
// Base dialog shell
// ──────────────────────────────────────────────────────────

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Prevents click-outside/ESC close. Use while an action is running. */
  locked?: boolean;
  /** Max width for the card. Defaults to 480px. */
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
  /** Optional class for the card element. */
  className?: string;
}

const SIZE_MAP = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-xl",
};

export function Dialog({
  open,
  onClose,
  locked,
  size = "md",
  children,
  className = "",
}: DialogProps) {
  // ESC to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !locked) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, locked, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !locked) onClose();
      }}
    >
      <div
        className={`bg-card w-full ${SIZE_MAP[size]} rounded-2xl border border-border shadow-2xl flex flex-col max-h-[90vh] overflow-hidden ${className}`}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({
  title,
  subtitle,
  tone = "default",
  icon,
}: DialogHeaderProps) {
  const tokens = TONE_MAP[tone];
  const IconComp = icon === null ? null : (icon ?? tokens.icon);

  return (
    <div className="p-5 md:p-6 flex items-start gap-4">
      {IconComp && (
        <div
          className={`shrink-0 h-11 w-11 rounded-full ${tokens.iconBg} ${tokens.iconFg} flex items-center justify-center`}
          aria-hidden
        >
          <IconComp size={20} />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <h2 className="text-foreground font-semibold text-[17px] leading-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="text-text-secondary text-sm mt-1 leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}

export function DialogBody({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`px-5 md:px-6 pb-2 space-y-3 ${className}`}>{children}</div>
  );
}

export function DialogFooter({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`px-5 md:px-6 py-4 mt-2 border-t border-border/30 flex items-center justify-end gap-2 flex-wrap ${className}`}
    >
      {children}
    </div>
  );
}

export function DialogCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="absolute top-3 right-3 text-text-muted hover:text-foreground p-1.5 rounded-full hover:bg-sidebar transition-colors"
      aria-label="Close"
    >
      <X size={16} />
    </button>
  );
}

// ──────────────────────────────────────────────────────────
// Imperative confirm() + alert() replacement
// ──────────────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  subtitle?: string;
  tone?: DialogTone;
  /** Override the tone's default icon. */
  icon?: LucideIcon | null;
  /** CTA label. Defaults: "Confirm" | "Delete" for destructive | "Got it" for alert mode. */
  confirmLabel?: string;
  /** Cancel label. Defaults to "Cancel". Pass `null` to hide (alert mode). */
  cancelLabel?: string | null;
  /** Extra body copy below the subtitle — paragraphs or custom React. */
  body?: React.ReactNode;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  alert: (opts: ConfirmOptions) => Promise<void>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const ConfirmContext = React.createContext<ConfirmContextValue | null>(null);

export interface PromptOptions {
  title: string;
  subtitle?: string;
  tone?: DialogTone;
  icon?: LucideIcon | null;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Optional synchronous validator. Return an error string, or null/undefined if ok. */
  validate?: (value: string) => string | null | undefined;
}

interface PromptRequest extends PromptOptions {
  resolve: (value: string | null) => void;
}

/**
 * Mount this near the root (e.g. in the (app) layout) so any client
 * component can call `useConfirm()` / `.confirm(...)` imperatively.
 */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const [promptReq, setPromptReq] = useState<PromptRequest | null>(null);
  const [promptReqKey, setPromptReqKey] = useState(0);

  const value: ConfirmContextValue = {
    confirm: (opts) =>
      new Promise<boolean>((resolve) => {
        setConfirmReq({ ...opts, resolve });
      }),
    alert: (opts) =>
      new Promise<void>((resolve) => {
        setConfirmReq({
          ...opts,
          cancelLabel: null,
          confirmLabel: opts.confirmLabel ?? "Got it",
          resolve: () => resolve(),
        });
      }),
    prompt: (opts) =>
      new Promise<string | null>((resolve) => {
        setPromptReq({ ...opts, resolve });
        setPromptReqKey((n) => n + 1);
      }),
  };

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ConfirmDialog
        req={confirmReq}
        onDone={(ok) => {
          confirmReq?.resolve(ok);
          setConfirmReq(null);
        }}
      />
      <PromptDialog
        key={promptReqKey}
        req={promptReq}
        onDone={(value) => {
          promptReq?.resolve(value);
          setPromptReq(null);
        }}
      />
    </ConfirmContext.Provider>
  );
}

export function useDialogs(): ConfirmContextValue {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) {
    throw new Error(
      "useDialogs() must be used inside <DialogProvider>. Check the app layout."
    );
  }
  return ctx;
}

function ConfirmDialog({
  req,
  onDone,
}: {
  req: ConfirmRequest | null;
  onDone: (ok: boolean) => void;
}) {
  if (!req) return null;

  const tone = req.tone ?? "default";
  const confirmVariant =
    tone === "destructive" ? "destructive" : "default";
  const defaultConfirmLabel =
    tone === "destructive" ? "Delete" : "Confirm";

  return (
    <Dialog open onClose={() => onDone(false)}>
      <DialogHeader
        title={req.title}
        subtitle={req.subtitle}
        tone={tone}
        icon={req.icon}
      />
      {req.body && <DialogBody>{req.body}</DialogBody>}
      <DialogFooter>
        {req.cancelLabel !== null && (
          <Button variant="ghost" onClick={() => onDone(false)}>
            {req.cancelLabel ?? "Cancel"}
          </Button>
        )}
        <Button variant={confirmVariant} onClick={() => onDone(true)}>
          {req.confirmLabel ?? defaultConfirmLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function PromptDialog({
  req,
  onDone,
}: {
  req: PromptRequest | null;
  onDone: (value: string | null) => void;
}) {
  // Component is remounted via `key={promptReqKey}` whenever a new
  // prompt is opened, so initial state is always right — no effect
  // needed to sync `req.defaultValue` after mount.
  const [value, setValue] = useState(req?.defaultValue ?? "");
  const [error, setError] = useState<string | null>(null);

  if (!req) return null;

  const submit = () => {
    const err = req.validate?.(value) ?? null;
    if (err) {
      setError(err);
      return;
    }
    onDone(value);
  };

  return (
    <Dialog open onClose={() => onDone(null)}>
      <DialogHeader
        title={req.title}
        subtitle={req.subtitle}
        tone={req.tone ?? "default"}
        icon={req.icon}
      />
      <DialogBody>
        <Input
          autoFocus
          value={value}
          placeholder={req.placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        {error && (
          <p className="text-xs text-status-red" role="alert">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => onDone(null)}>
          {req.cancelLabel ?? "Cancel"}
        </Button>
        <Button onClick={submit}>{req.confirmLabel ?? "Confirm"}</Button>
      </DialogFooter>
    </Dialog>
  );
}
