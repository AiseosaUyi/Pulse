"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddPostModal } from "@/components/posts/AddPostModal";

export function AddPostButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={16} />
        Log Post
      </Button>
      <AddPostModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
