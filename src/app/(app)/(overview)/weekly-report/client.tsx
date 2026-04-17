"use client";

import { useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateWeeklyDigest } from "@/lib/actions/weekly-digest";

export function GenerateDigestButton({
  tenantSlug,
  hasDigest,
}: {
  tenantSlug: string;
  hasDigest: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const res = await generateWeeklyDigest(tenantSlug, { force: true });
      if (!res.success) alert(res.error);
    });
  };

  return (
    <Button size="sm" onClick={handleClick} disabled={isPending}>
      <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
      {isPending ? "Synthesizing..." : hasDigest ? "Regenerate" : "Generate digest"}
    </Button>
  );
}
