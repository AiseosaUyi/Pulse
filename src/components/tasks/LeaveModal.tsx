"use client";

import { useState, useTransition } from "react";
import { X, CalendarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/Toaster";
import type { TeamPerson } from "@/lib/types/tasks";
import { recordLeaveAction } from "@/lib/actions/tasks";

interface LeaveModalProps {
  isOpen: boolean;
  onClose: () => void;
  people: TeamPerson[];
  currentUserId: string;
  isAdmin: boolean;
}

export function LeaveModal({
  isOpen,
  onClose,
  people,
  currentUserId,
  isAdmin,
}: LeaveModalProps) {
  const [isPending, startTransition] = useTransition();

  const myPerson = people.find((p) => p.userId === currentUserId);
  const [personId, setPersonId] = useState(myPerson?.id ?? people[0]?.id ?? "");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [reason, setReason] = useState("");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!personId) {
      toast.error("Please select a team member");
      return;
    }
    if (!startsOn || !endsOn) {
      toast.error("Start and end dates are required");
      return;
    }
    if (startsOn > endsOn) {
      toast.error("Start date must be before end date");
      return;
    }

    startTransition(async () => {
      const res = await recordLeaveAction({
        personId,
        startsOn,
        endsOn,
        reason: reason.trim() || null,
      });

      if (!res.success) {
        toast.error(res.error ?? "Failed to record leave");
      } else {
        toast.success("Leave recorded. Scheduled tasks in this period marked as skipped.");
        onClose();
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarOff size={18} className="text-primary-500" />
            <h2 className="text-base font-bold text-foreground">Record Planned Leave</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-text-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-text-muted">
          Scheduled tasks falling inside a leave window are automatically marked as{" "}
          <strong>skipped</strong>, not missed. They will not be counted as breaches.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="font-semibold text-foreground uppercase tracking-wider block mb-1">
              Team Member
            </label>
            <select
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
              disabled={!isAdmin && Boolean(myPerson)}
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-foreground text-xs"
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-foreground uppercase tracking-wider block mb-1">
                Starts On *
              </label>
              <Input
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                required
                className="text-xs h-9"
              />
            </div>

            <div>
              <label className="font-semibold text-foreground uppercase tracking-wider block mb-1">
                Ends On *
              </label>
              <Input
                type="date"
                value={endsOn}
                onChange={(e) => setEndsOn(e.target.value)}
                required
                className="text-xs h-9"
              />
            </div>
          </div>

          <div>
            <label className="font-semibold text-foreground uppercase tracking-wider block mb-1">
              Reason (optional)
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Annual leave, public holiday, sick leave"
              className="text-xs h-9"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Recording..." : "Save Leave"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
