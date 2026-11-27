"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RefreshCw, Mail, ListPlus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { regenerateWeeklyReportAction } from "@/lib/actions/weekly-digest";
import { emailReportToMeAction, makeTaskFromReportAction } from "@/lib/actions/weekly-report-tasks";
import { useDialogs } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toaster";
import { usePeople } from "@/lib/hooks/usePeople";

export function GenerateDigestButton({ hasDigest }: { hasDigest: boolean }) {
  const dialogs = useDialogs();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const res = await regenerateWeeklyReportAction();
      if (!res.success) {
        await dialogs.alert({ title: "Couldn't make the report", subtitle: res.error, tone: "destructive" });
        return;
      }
      router.refresh();
      toast.success("Report updated");
    });
  };

  return (
    <Button size="sm" onClick={handleClick} disabled={isPending}>
      <RefreshCw size={14} className={isPending ? "animate-spin" : ""} />
      {isPending ? "Writing the report..." : hasDigest ? "Regenerate" : "Make this week's report"}
    </Button>
  );
}

export function EmailMeButton({ digestId }: { digestId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await emailReportToMeAction(digestId);
          if (res.success) toast.success("Sent to your email");
          else toast.error("Couldn't send it", res.error);
        })
      }
    >
      <Mail size={14} />
      {isPending ? "Sending..." : "Email it to me"}
    </Button>
  );
}

/** "Make task" for one recommended action: pick who does it, then create it in Tasks. */
export function ReportActionTask({
  digestId,
  index,
  alreadyTask,
}: {
  digestId: string;
  index: number;
  alreadyTask: boolean;
}) {
  const { activePeople, currentUserPerson } = usePeople();
  const [owner, setOwner] = useState<string>("");
  const [done, setDone] = useState(alreadyTask);
  const [isPending, startTransition] = useTransition();
  const chosen = owner || currentUserPerson?.id || "";

  if (done) {
    return (
      <Link href="/tasks" className="inline-flex items-center gap-1 text-xs font-semibold text-success-500 hover:underline">
        <Check size={12} /> In Tasks
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={chosen}
        onChange={(e) => setOwner(e.target.value)}
        aria-label="Who does this"
        className="h-8 rounded-lg border border-border bg-card px-2 text-xs text-foreground cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <option value="">Nobody yet</option>
        {activePeople.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const res = await makeTaskFromReportAction({ digestId, index, ownerPersonId: chosen || null });
            if (!res.success) {
              toast.error("Couldn't make the task", res.error);
              return;
            }
            setDone(true);
            toast.success(res.existed ? "Already in Tasks" : "Added to Tasks");
          })
        }
      >
        <ListPlus size={14} />
        {isPending ? "Adding..." : "Make task"}
      </Button>
    </div>
  );
}
