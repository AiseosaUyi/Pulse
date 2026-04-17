"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddCompetitorModal } from "@/components/competitors/AddCompetitorModal";

export function AddCompetitorButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={16} />
        Add Competitor
      </Button>
      <AddCompetitorModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
