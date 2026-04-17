"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddCampaignModal } from "@/components/campaigns/AddCampaignModal";

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
