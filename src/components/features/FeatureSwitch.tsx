"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setFeatureAction } from "@/lib/actions/features";
import { toast } from "@/components/ui/Toaster";
import type { FeatureKey } from "@/lib/features/registry";

/** Button that switches one feature on (used on a switched-off page). */
export function TurnOnButton({ feature }: { feature: FeatureKey }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setFeatureAction({ key: feature, on: true });
          if (r.ok) router.refresh();
          else toast.error("Could not switch it on", r.error);
        })
      }
      className="rounded-full bg-primary-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
    >
      {pending ? "Switching on..." : "Switch on"}
    </button>
  );
}

/** On/off toggle row for the Features settings page. */
export function FeatureToggle({ feature, on, label }: { feature: FeatureKey; on: boolean; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label}: ${on ? "on" : "off"}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await setFeatureAction({ key: feature, on: !on });
          if (r.ok) router.refresh();
          else toast.error("Could not save", r.error);
        })
      }
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
        on ? "bg-primary-500" : "bg-gray-300 dark:bg-white-200"
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
