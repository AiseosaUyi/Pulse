"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { disconnectPlatform } from "@/lib/actions/platform-connections";
import type { OAuthPlatform } from "@/lib/services/platform-connections";

export default function DisconnectButton({ platform }: { platform: OAuthPlatform }) {
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const router = useRouter();

  async function handleDisconnect() {
    if (!confirm) { setConfirm(true); return; }
    setLoading(true);
    await disconnectPlatform(platform);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleDisconnect}
      disabled={loading}
      className={[
        "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        confirm
          ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:border-red-700 dark:text-red-400"
          : "border-border text-text-muted hover:border-red-300 hover:text-red-600",
        loading ? "opacity-50 cursor-not-allowed" : "",
      ].join(" ")}
    >
      {loading ? "Disconnecting…" : confirm ? "Confirm disconnect" : "Disconnect"}
    </button>
  );
}
