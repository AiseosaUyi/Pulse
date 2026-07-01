"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportDataModal } from "./ImportDataModal";

export function ImportDataButton({ tenantSlug }: { tenantSlug: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <Upload size={13} /> Import data
      </Button>
      <ImportDataModal open={open} onClose={() => setOpen(false)} tenantSlug={tenantSlug} />
    </>
  );
}
