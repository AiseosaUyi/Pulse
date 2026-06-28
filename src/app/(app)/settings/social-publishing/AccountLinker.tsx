"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Link2, Unlink, ExternalLink, X } from "lucide-react";
import { linkSocialAccount, unlinkSocialAccount } from "@/lib/actions/social-accounts";
import { toast } from "@/components/ui/Toaster";
import { Dialog } from "@/components/ui/Dialog";
import { InstagramIcon, LinkedInIcon, TikTokIcon } from "@/components/icons/social";
import type { ComponentType } from "react";

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

const PLATFORMS: {
  key: "instagram" | "linkedin" | "tiktok";
  label: string;
  color: string;
  Icon: ComponentType<{ size?: number }>;
}[] = [
  { key: "instagram", label: "Instagram", color: "#E1306C", Icon: InstagramIcon },
  { key: "linkedin",  label: "LinkedIn",  color: "#0A66C2", Icon: LinkedInIcon },
  { key: "tiktok",   label: "TikTok",    color: "#010101", Icon: TikTokIcon },
];

type PlatformKey = (typeof PLATFORMS)[number]["key"];

type ModalState =
  | { type: "none" }
  | { type: "setup"; platform: PlatformKey; label: string }
  | { type: "pick"; platform: PlatformKey; label: string; options: SocialApiAccount[] };

export default function AccountLinker({
  availableAccounts,
  linkedMappings,
}: {
  availableAccounts: SocialApiAccount[];
  linkedMappings: LinkedMapping[];
}) {
  const [linked, setLinked] = useState<LinkedMapping[]>(linkedMappings);
  const [modal, setModal] = useState<ModalState>({ type: "none" });
  const [pending, startTransition] = useTransition();

  function getLinked(platform: string) {
    return linked.find((m) => m.platform === platform) ?? null;
  }

  function getOptions(platform: string) {
    return availableAccounts.filter((a) => a.platform === platform);
  }

  function handleConnectClick(platform: PlatformKey, label: string) {
    const options = getOptions(platform);
    if (options.length === 0) {
      setModal({ type: "setup", platform, label });
    } else if (options.length === 1) {
      doLink(options[0]);
    } else {
      setModal({ type: "pick", platform, label, options });
    }
  }

  function doLink(account: SocialApiAccount) {
    setModal({ type: "none" });
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
        toast.success(`${account.name} connected`);
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
        toast.success("Account disconnected");
      }
    });
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {PLATFORMS.map(({ key, label, color, Icon }) => {
          const connection = getLinked(key);
          return (
            <div
              key={key}
              className="bg-card border border-border rounded-2xl p-4 flex items-center gap-4"
            >
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: connection ? `${color}18` : "#9CA3AF18" }}
              >
                <span style={{ color: connection ? color : "#9CA3AF" }}>
                  <Icon size={20} />
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{label}</span>
                  {connection && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-950/40 dark:border-green-700 dark:text-green-400">
                      <CheckCircle2 size={9} />
                      Connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted mt-0.5">
                  {connection ? connection.handle : "Not connected"}
                </p>
              </div>

              <div className="shrink-0">
                {connection ? (
                  <button
                    onClick={() => handleUnlink(key)}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-muted hover:border-red-300 hover:text-red-600 transition-colors disabled:opacity-50"
                  >
                    <Unlink size={11} />
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => handleConnectClick(key, label)}
                    disabled={pending}
                    className="inline-flex items-center gap-1.5 rounded-full border border-primary-500 bg-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    <Link2 size={11} />
                    Connect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Setup instructions modal — no SocialAPI account available yet */}
      <Dialog open={modal.type === "setup"} onClose={() => setModal({ type: "none" })} size="sm">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">
              Connect {modal.type === "setup" ? modal.label : ""}
            </h2>
            <button
              onClick={() => setModal({ type: "none" })}
              className="text-text-muted hover:text-foreground transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <p className="text-sm text-text-muted mb-4">
            Pulse publishes through SocialAPI.ai. To connect your{" "}
            {modal.type === "setup" ? modal.label : ""} account:
          </p>
          <ol className="space-y-2 text-sm text-text-muted list-decimal list-inside mb-5">
            <li>Go to your SocialAPI.ai dashboard</li>
            <li>Connect your {modal.type === "setup" ? modal.label : ""} account there</li>
            <li>Come back here and refresh — it will appear automatically</li>
          </ol>
          <a
            href="https://social-api.ai/dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-primary-500 bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            Open SocialAPI.ai <ExternalLink size={13} />
          </a>
        </div>
      </Dialog>

      {/* Account picker modal — multiple SocialAPI accounts for this platform */}
      <Dialog open={modal.type === "pick"} onClose={() => setModal({ type: "none" })} size="sm">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Choose your {modal.type === "pick" ? modal.label : ""} account
              </h2>
              <p className="text-xs text-text-muted mt-0.5">
                Pick the account to connect to this workspace.
              </p>
            </div>
            <button
              onClick={() => setModal({ type: "none" })}
              className="text-text-muted hover:text-foreground transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {modal.type === "pick" &&
              modal.options.map((account) => (
                <button
                  key={account.id}
                  onClick={() => doLink(account)}
                  disabled={pending}
                  className="flex items-center gap-3 rounded-xl border border-border p-3 hover:border-primary-500/50 hover:bg-primary-500/5 transition-colors text-left disabled:opacity-50"
                >
                  {(() => {
                    const p = PLATFORMS.find((pl) => pl.key === account.platform);
                    return p ? (
                      <div
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg"
                        style={{ backgroundColor: `${p.color}18` }}
                      >
                        <span style={{ color: p.color }}>
                          <p.Icon size={16} />
                        </span>
                      </div>
                    ) : null;
                  })()}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{account.name}</p>
                    <p className="text-xs text-text-muted">@{account.username}</p>
                  </div>
                </button>
              ))}
          </div>
        </div>
      </Dialog>
    </>
  );
}
