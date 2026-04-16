"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ActionResult = { success: boolean; message: string };

interface SettingsFormProps {
  action: (formData: FormData) => Promise<ActionResult>;
  children: React.ReactNode;
  submitLabel: string;
  resetOnSuccess?: boolean;
  className?: string;
}

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
      <div className="flex items-center gap-3 mt-5">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        {status && (
          <span
            className={cn(
              "text-xs",
              status.success ? "text-success-500" : "text-error-500"
            )}
          >
            {status.message}
          </span>
        )}
      </div>
    </form>
  );
}
