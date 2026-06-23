"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Submit button that reflects the parent <form>'s server-action pending state. */
export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="xl" className="w-full" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="animate-spin" /> Working…
        </>
      ) : (
        children
      )}
    </Button>
  );
}
