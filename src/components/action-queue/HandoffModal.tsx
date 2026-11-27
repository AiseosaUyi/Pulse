"use client";

import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { Dialog, DialogHeader, DialogBody, DialogFooter, DialogCloseButton } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/Toaster";
import { markConversationHandoffAction } from "@/lib/actions/handoff";
import { CHANNEL_LABELS, type HandoffChannel } from "@/lib/services/handoff";

interface HandoffModalProps {
  open: boolean;
  onClose: () => void;
  platform: string;
  threadExternalId: string;
  fromName?: string | null;
  onSuccess: () => void;
}

const CHANNELS: Array<{ value: HandoffChannel; label: string }> = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "phone", label: "Phone call" },
  { value: "email", label: "Email" },
  { value: "in_person", label: "In person" },
  { value: "other", label: "Other" },
];

export function HandoffModal({
  open,
  onClose,
  platform,
  threadExternalId,
  fromName,
  onSuccess,
}: HandoffModalProps) {
  const [channel, setChannel] = useState<HandoffChannel>("whatsapp");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await markConversationHandoffAction({
        platform,
        threadExternalId,
        channel,
        contact: contact.trim() || null,
        note: note.trim() || null,
      });

      if (!res.success) {
        toast.error("Couldn't save handoff", res.error);
        return;
      }

      toast.success(`Moved to ${CHANNEL_LABELS[channel] ?? channel}`);
      onSuccess();
      onClose();
    });
  }

  return (
    <Dialog open={open} onClose={onClose} size="sm">
      <DialogCloseButton onClose={onClose} />
      <DialogHeader
        title={`Move ${fromName ?? "conversation"} off ${platform.charAt(0).toUpperCase() + platform.slice(1)}`}
        subtitle="Mark this thread as being continued on another channel so it stops raising alerts."
        icon={MessageCircle}
        tone="default"
      />
      <form onSubmit={handleSubmit}>
        <DialogBody className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Destination channel
            </label>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as HandoffChannel)}
              className="w-full h-9 px-3 rounded-lg border border-border bg-card text-sm text-foreground outline-none focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/30 cursor-pointer"
            >
              {CHANNELS.map((ch) => (
                <option key={ch.value} value={ch.value}>
                  {ch.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Contact handle or phone number <span className="text-text-muted font-normal">(optional)</span>
            </label>
            <Input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="+234 801 234 5678 or email"
              className="h-9 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Note <span className="text-text-muted font-normal">(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Taking over on WhatsApp for booking details"
              rows={2}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-blue-500 focus-visible:ring-1 focus-visible:ring-blue-500/30 resize-none"
            />
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="tertiary" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Saving…" : "Save handoff"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
