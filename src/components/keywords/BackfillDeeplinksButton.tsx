"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Wand2 } from "lucide-react";
import { backfillKeywordDeeplinks } from "@/lib/actions/keyword-deeplink";
import { useDialogs } from "@/components/ui/Dialog";

// Bulk-maps every tracked keyword that doesn't yet have a Gruve deep-link.
export function BackfillDeeplinksButton() {
  const router = useRouter();
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();

  const run = () => {
    startTransition(async () => {
      const res = await backfillKeywordDeeplinks();
      if (!res.success) {
        await dialogs.alert({
          title: "Couldn't generate links",
          subtitle: res.error,
          tone: "destructive",
        });
        return;
      }
      await dialogs.alert({
        title: "Gruve links generated",
        subtitle:
          res.updated === 0
            ? "Every keyword already has a Gruve link."
            : `Mapped ${res.updated} keyword${res.updated === 1 ? "" : "s"} to Gruve deep-links.`,
      });
      router.refresh();
    });
  };

  return (
    <button
      onClick={run}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground hover:bg-sidebar transition-colors disabled:opacity-60"
    >
      <Wand2 size={14} />
      {isPending ? "Generating…" : "Generate Gruve links"}
    </button>
  );
}
