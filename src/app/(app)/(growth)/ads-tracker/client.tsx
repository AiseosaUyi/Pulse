"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDialogs } from "@/components/ui/Dialog";
import { AddCampaignModal } from "@/components/campaigns/AddCampaignModal";
import { deleteCampaign } from "@/lib/actions/campaigns";

export function AddCampaignButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={16} />
        New Campaign
      </Button>
      <AddCampaignModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function DeleteCampaignButton({
  campaignId,
  campaignName,
}: {
  campaignId: string;
  campaignName: string;
}) {
  const dialogs = useDialogs();
  const [isPending, startTransition] = useTransition();

  const handleClick = async () => {
    const ok = await dialogs.confirm({
      title: `Delete "${campaignName}"?`,
      subtitle:
        "The campaign and its spend / revenue entries will be permanently removed.",
      tone: "destructive",
      confirmLabel: "Delete campaign",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteCampaign(campaignId);
      if (!res.success) {
        await dialogs.alert({
          title: "Couldn't delete",
          subtitle: res.error,
          tone: "warning",
        });
      }
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="p-1.5 rounded-md text-text-muted hover:text-status-red hover:bg-status-red/10 transition-colors"
      title="Delete campaign"
      aria-label={`Delete ${campaignName}`}
    >
      {isPending ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <Trash2 size={12} />
      )}
    </button>
  );
}
