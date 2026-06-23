import { Share2 } from "lucide-react";
import { SettingsPageHeading } from "../_shared";
import {
  XIcon,
  LinkedInIcon,
  InstagramIcon,
  TikTokIcon,
  YouTubeIcon,
} from "@/components/icons/social";

interface PlatformConfig {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  brandColor: string;
  status: "not_connected" | "pending_review";
  note?: string;
  reviewWait?: string;
}

const PLATFORMS: PlatformConfig[] = [
  {
    id: "x",
    label: "X (Twitter)",
    icon: XIcon,
    brandColor: "#000000",
    status: "not_connected",
    note: "Requires X API Basic ($100/mo) for scheduling.",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: LinkedInIcon,
    brandColor: "#0A66C2",
    status: "pending_review",
    reviewWait: "4–6 weeks",
    note: "App review in progress. Connect button unlocks when approved.",
  },
  {
    id: "instagram",
    label: "Instagram",
    icon: InstagramIcon,
    brandColor: "#E1306C",
    status: "pending_review",
    reviewWait: "4–8 weeks",
    note: "Meta app review in progress. Requires a Business or Creator account.",
  },
  {
    id: "tiktok",
    label: "TikTok",
    icon: TikTokIcon,
    brandColor: "#010101",
    status: "pending_review",
    reviewWait: "2–4 weeks",
    note: "TikTok app review in progress. Video-only posts.",
  },
  {
    id: "youtube",
    label: "YouTube",
    icon: YouTubeIcon,
    brandColor: "#FF0000",
    status: "not_connected",
    note: "Community posts require 500+ subscribers.",
  },
];

export default function SocialPublishingSettingsPage() {
  return (
    <div>
      <SettingsPageHeading
        icon={Share2}
        title="Social publishing"
        subtitle="Connect your social accounts to schedule and publish posts directly from Pulse."
      />

      <section className="flex flex-col gap-3">
        {PLATFORMS.map((platform) => {
          const Icon = platform.icon;
          const isPending = platform.status === "pending_review";

          return (
            <div
              key={platform.id}
              className="bg-card border border-border rounded-2xl p-5 flex items-start gap-4"
            >
              {/* Icon */}
              <div
                className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${platform.brandColor}15` }}
              >
                <span style={{ color: platform.brandColor }}>
                  <Icon size={20} />
                </span>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-foreground">{platform.label}</span>
                  {isPending && (
                    <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-400">
                      Review pending · {platform.reviewWait}
                    </span>
                  )}
                </div>
                {platform.note && (
                  <p className="mt-0.5 text-xs text-text-muted">{platform.note}</p>
                )}
              </div>

              {/* Action */}
              <div className="shrink-0">
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center rounded-full border border-border px-3 py-1.5 text-xs font-medium text-text-muted cursor-not-allowed opacity-50"
                >
                  {isPending ? "Connect when approved" : "Connect"}
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <p className="mt-6 text-xs text-text-muted">
        OAuth connections are coming in the next release. Variants are ready to copy from the Composer today.
      </p>
    </div>
  );
}
