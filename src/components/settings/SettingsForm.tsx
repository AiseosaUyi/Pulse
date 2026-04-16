"use client";

import { useState, useTransition } from "react";

type ActionResult = { success: boolean; message: string };

interface SettingsFormProps {
  action: (formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submitLabel: string;
  resetOnSuccess?: boolean;
  className?: string;
}

// Wraps a form around a Server Action that returns { success, message } —
// shows a transient status line after submit.
export function SettingsForm({
  action,
  children,
  submitLabel,
  resetOnSuccess,
  className,
}: SettingsFormProps) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<ActionResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    startTransition(async () => {
      const res = await action(formData);
      setStatus(res);
      if (res.success && resetOnSuccess) form.reset();
    });
  }

  return (
    <form onSubmit={onSubmit} className={className}>
      {children}
      <div className="flex items-center gap-3 mt-4">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white gradient-purple-pink hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        {status && (
          <span className={`text-xs ${status.success ? "text-emerald-400" : "text-red-400"}`}>
            {status.message}
          </span>
        )}
      </div>
    </form>
  );
}
