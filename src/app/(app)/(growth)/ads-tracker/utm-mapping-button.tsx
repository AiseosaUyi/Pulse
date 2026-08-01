"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmAdCampaignUtmMapping } from "@/lib/actions/ads-platform";
import type { MatchConfidence } from "@/lib/attribution/ads";

export function UtmMappingButton({
  adAccountId,
  campaignExternalId,
  confidence,
  matchedUtm,
}: {
  adAccountId: string;
  campaignExternalId: string;
  confidence: MatchConfidence;
  matchedUtm: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(matchedUtm ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const res = await confirmAdCampaignUtmMapping(adAccountId, campaignExternalId, value.trim());
            if (!res.success) {
              setError(res.error);
              return;
            }
            setEditing(false);
            router.refresh();
          });
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="utm_campaign value"
          className="h-7 w-40 rounded border border-border bg-card px-2 text-xs text-foreground"
          disabled={isPending}
          autoFocus
        />
        <button type="submit" disabled={isPending || !value.trim()} className="text-xs text-primary-500 hover:underline disabled:opacity-50">
          Save
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-text-muted hover:underline">
          Cancel
        </button>
        {error && <span className="text-xs text-status-red">{error}</span>}
      </form>
    );
  }

  const label =
    confidence === "confirmed"
      ? `Confirmed · ${matchedUtm}`
      : confidence === "guessed"
        ? `Guessed · ${matchedUtm}`
        : "Not matched";
  const color = confidence === "confirmed" ? "text-status-green" : confidence === "guessed" ? "text-status-yellow" : "text-text-muted";

  return (
    <button onClick={() => setEditing(true)} className={`text-xs hover:underline ${color}`} title="Click to confirm or correct which utm_campaign value maps to this ad campaign">
      {label}
    </button>
  );
}
