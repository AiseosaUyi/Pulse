"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddKeywordModal } from "@/components/keywords/AddKeywordModal";

export function AddKeywordButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={16} />
        Track Keyword
      </Button>
      <AddKeywordModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
