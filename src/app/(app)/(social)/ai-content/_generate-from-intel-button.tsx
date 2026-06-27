"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { generateAndSaveFromIntel } from "@/lib/actions/generate-from-intel";
import { toast } from "@/components/ui/Toaster";

export function GenerateFromIntelButton({
  tenantSlug,
}: {
  tenantSlug: string;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleClick() {
    setLoading(true);
    try {
      const result = await generateAndSaveFromIntel(tenantSlug);
      if (result.error && !result.created) {
        toast.error(result.error);
      } else {
        toast.success(
          `${result.created} draft${result.created === 1 ? "" : "s"} added to your calendar`
        );
        router.refresh();
      }
    } catch {
      toast.error("Failed to generate posts. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-3 md:px-4 py-2 border border-primary-500 rounded-lg text-xs md:text-sm text-primary-500 hover:bg-primary-50 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Sparkles size={14} />
      )}
      {loading ? "Generating…" : "Generate from Intel"}
    </button>
  );
}
