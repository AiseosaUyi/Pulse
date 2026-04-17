"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddEngagementModal } from "@/components/engagement/AddEngagementModal";

export function AddEngagementButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={16} />
        Log Message
      </Button>
      <AddEngagementModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
