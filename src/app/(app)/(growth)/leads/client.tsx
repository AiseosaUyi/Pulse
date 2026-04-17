"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddLeadModal } from "@/components/leads/AddLeadModal";

export function AddLeadButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={16} />
        Add Lead
      </Button>
      <AddLeadModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
