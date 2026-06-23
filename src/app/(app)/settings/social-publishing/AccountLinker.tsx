"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Link2, Unlink } from "lucide-react";
import { linkSocialAccount, unlinkSocialAccount } from "@/lib/actions/social-accounts";
import { toast } from "@/components/ui/Toaster";

interface SocialApiAccount {
  id: string;
  platform: string;
  username: string;
  name: string;
  profilePictureUrl?: string;
}

interface LinkedMapping {
  platform: string;
  socialApiAccountId: string;
  handle: string;
}

const PLATFORM_ICONS: Record<string, string> = {
  instagram: "IG",
  linkedin: "LI",
  tiktok: "TK",
  youtube: "YT",
  facebook: "FB",
  threads: "TH",
};

const PLATFORM_COLORS: Record<string, string> = {
  instagram: "#E1306C",
  linkedin: "#0A66C2",
  tiktok: "#010101",
  youtube: "#FF0000",
  facebook: "#1877F2",
  threads: "#000000",
};

export default function AccountLinker({
  availableAccounts,
  linkedMappings,
}: {
  availableAccounts: SocialApiAccount[];
  linkedMappings: LinkedMapping[];
}) {
  const [linked, setLinked] = useState<LinkedMapping[]>(linkedMappings);
  const [pending, startTransition] = useTransition();

  const isLinked = (accountId: string) => linked.some((m) => m.socialApiAccountId === accountId);
  const linkedPlatforms = new Set(linked.map((m) => m.platform));

  function handleLink(account: SocialApiAccount) {
    startTransition(async () => {
      const res = await linkSocialAccount(
        account.platform,
        account.id,
        account.username,
        account.name
      );
      if (res.error) {
        toast.error(res.error);
      } else {
        setLinked((prev) => [
          ...prev.filter((m) => m.platform !== account.platform),
          { platform: account.platform, socialApiAccountId: account.id, handle: `@${account.username}` },
        ]);
        toast.success(`${account.name} linked`);
      }
    });
  }

  function handleUnlink(platform: string) {
    startTransition(async () => {
      const res = await unlinkSocialAccount(platform);
      if (res.error) {
        toast.error(res.error);
      } else {
        setLinked((prev) => prev.filter((m) => m.platform !== platform));
        toast.success("Account unlinked");
      }
    });
  }

  if (availableAccounts.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-8 text-center">
        <p className="text-sm text-text-muted">
          No accounts connected in SocialAPI.ai yet.
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Connect your Instagram, LinkedIn, TikTok, or YouTube in the SocialAPI.ai dashboard, then refresh this page.
        </p>
      </div>
    );
  }

  // Group by platform, showing linked ones first
  const sorted = [...availableAccounts].sort((a, b) => {
    const aLinked = isLinked(a.id) ? 0 : 1;
    const bLinked = isLinked(b.id) ? 0 : 1;
    return aLinked - bLinked;
  });

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((account) => {
        const linked_ = isLinked(account.id);
        const alreadyHasPlatform = !linked_ && linkedPlatforms.has(account.platform);
        const color = PLATFORM_COLORS[account.platform] ?? "#666";
        const abbr = PLATFORM_ICONS[account.platform] ?? account.platform.slice(0, 2).toUpperCase();

        return (
          <div
            key={account.id}
            className="bg-card border border-border rounded-2xl p-4 flex items-center gap-4"
          >
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white"
              style={{ backgroundColor: color }}
            >
              {abbr}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-foreground">{account.name}</span>
                {linked_ && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-950/40 dark:border-green-700 dark:text-green-400">
                    <CheckCircle2 size={9} />
                    Linked
                  </span>
                )}
                {alreadyHasPlatform && (
                  <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-400">
                    Replace existing
                  </span>
                )}
              </div>
              <p className="text-xs text-text-muted capitalize">
                {account.platform} · @{account.username}
              </p>
            </div>

            <div className="shrink-0">
              {linked_ ? (
                <button
                  onClick={() => handleUnlink(account.platform)}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:border-red-300 hover:text-red-600 transition-colors disabled:opacity-50"
                >
                  <Unlink size={11} />
                  Unlink
                </button>
              ) : (
                <button
                  onClick={() => handleLink(account)}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Link2 size={11} />
                  {alreadyHasPlatform ? "Switch" : "Link"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
