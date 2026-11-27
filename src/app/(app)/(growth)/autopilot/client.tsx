"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toaster";
import { setAutopilotEnabled, unapproveInApp } from "@/lib/actions/outreach-autopilot";

export function AutopilotToggle({ enabled }: { enabled: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setAutopilotEnabled(!enabled);
          if (r.ok) {
            toast.success(enabled ? "Autopilot paused" : "Autopilot on", enabled ? "Nothing will be sent." : undefined);
            router.refresh();
          } else toast.error("Could not change Autopilot", r.error);
        })
      }
      className={
        enabled
          ? "rounded-full border border-border px-4 py-2 text-sm text-gray-1100 dark:text-foreground disabled:opacity-60"
          : "rounded-full bg-primary-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      }
    >
      {pending ? "Saving..." : enabled ? "Pause Autopilot" : "Turn on Autopilot"}
    </button>
  );
}

export function UnapproveButton({ dmId }: { dmId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await unapproveInApp(dmId);
          if (r.ok) {
            toast.success("Pulled back", "It is a draft again.");
            router.refresh();
          } else toast.error("Too late to pull back", r.error);
        })
      }
      className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs text-gray-1000 dark:text-text-muted disabled:opacity-60"
    >
      Don&apos;t send
    </button>
  );
}
