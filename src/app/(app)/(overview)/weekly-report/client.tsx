"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateWeeklyDigest } from "@/lib/actions/weekly-digest";
import { useDialogs } from "@/components/ui/Dialog";

export function GenerateDigestButton({
  tenantSlug,
  hasDigest,
}: {
  tenantSlug: string;
  hasDigest: boolean;
}) {
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const res = await generateWeeklyDigest(tenantSlug, { force: true });
      if (!res.success) {
        await dialogs.alert({
          title: "Couldn't generate digest",
          subtitle: res.error,
          tone: "destructive",
        });
      }
    });
  };

  return (
    <Button size="sm" onClick={handleClick} disabled={isPending}>
      <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
      {isPending ? "Synthesizing..." : hasDigest ? "Regenerate" : "Generate digest"}
    </Button>
  );
}
