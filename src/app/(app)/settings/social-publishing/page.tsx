import { Share2, CheckCircle2, AlertCircle } from "lucide-react";
import { SettingsPageHeading } from "../_shared";
import {
  XIcon,
  LinkedInIcon,
  InstagramIcon,
  TikTokIcon,
  YouTubeIcon,
} from "@/components/icons/social";
import { getCurrentTenant } from "@/lib/auth";
import { getAllPlatformConnections } from "@/lib/services/platform-connections";
import { isXConfigured } from "@/lib/integrations/platforms/x";
import { isYouTubeConfigured } from "@/lib/integrations/platforms/youtube";
import { isLinkedInConfigured } from "@/lib/integrations/platforms/linkedin";
import { isInstagramConfigured } from "@/lib/integrations/platforms/instagram";
import { isTikTokConfigured } from "@/lib/integrations/platforms/tiktok";
import DisconnectButton from "./DisconnectButton";

const PLATFORM_META = {
  x: {
    label: "X (Twitter)",
    icon: XIcon,
    brandColor: "#000000",
    note: "Requires X API Basic ($100/mo). Free tier does not allow write access.",
    connectPath: "/api/integrations/x/connect",
    pendingReview: false,
    reviewWait: null,
  },
  linkedin: {
    label: "LinkedIn",
    icon: LinkedInIcon,
    brandColor: "#0A66C2",
    note: "App review in progress. Connect button unlocks when approved.",
    connectPath: "/api/integrations/linkedin/connect",
    pendingReview: true,
    reviewWait: "4–6 weeks",
  },
  instagram: {
    label: "Instagram",
    icon: InstagramIcon,
    brandColor: "#E1306C",
    note: "Meta app review in progress. Requires a Business or Creator account.",
    connectPath: "/api/integrations/instagram/connect",
    pendingReview: true,
    reviewWait: "4–8 weeks",
  },
  tiktok: {
    label: "TikTok",
    icon: TikTokIcon,
    brandColor: "#010101",
    note: "TikTok app review in progress. Caption-only posts for now.",
    connectPath: "/api/integrations/tiktok/connect",
    pendingReview: true,
    reviewWait: "2–4 weeks",
  },
  youtube: {
    label: "YouTube",
    icon: YouTubeIcon,
    brandColor: "#FF0000",
    note: "Community posts require 500+ subscribers.",
    connectPath: "/api/integrations/youtube/connect",
    pendingReview: false,
    reviewWait: null,
  },
} as const;

type PlatformId = keyof typeof PLATFORM_META;

const CONFIGURED: Record<PlatformId, () => boolean> = {
  x: isXConfigured,
  linkedin: isLinkedInConfigured,
  instagram: isInstagramConfigured,
  tiktok: isTikTokConfigured,
  youtube: isYouTubeConfigured,
};

export default async function SocialPublishingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const params = await searchParams;
  const tenant = await getCurrentTenant();
  const connections = tenant ? await getAllPlatformConnections(tenant.slug) : [];
  const connectedSet = new Set(connections.map((c) => c.platform));

  return (
    <div>
      <SettingsPageHeading
        icon={Share2}
        title="Social publishing"
        subtitle="Connect your social accounts to schedule and publish posts directly from Pulse."
      />

      {params.connected && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-700 dark:bg-green-950/40 dark:text-green-300">
          <CheckCircle2 size={15} />
          {PLATFORM_META[params.connected as PlatformId]?.label ?? params.connected} connected successfully.
        </div>
      )}
      {params.error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-300">
          <AlertCircle size={15} />
          {decodeURIComponent(params.error)}
        </div>
      )}

      <section className="flex flex-col gap-3">
        {(Object.keys(PLATFORM_META) as PlatformId[]).map((id) => {
          const meta = PLATFORM_META[id];
          const Icon = meta.icon;
          const isConnected = connectedSet.has(id);
          const conn = connections.find((c) => c.platform === id);
          const isConfigured = CONFIGURED[id]();
          const canConnect = isConfigured && !meta.pendingReview;

          return (
            <div
              key={id}
              className="bg-card border border-border rounded-2xl p-5 flex items-start gap-4"
            >
              <div
                className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${meta.brandColor}15` }}
              >
                <span style={{ color: meta.brandColor }}>
                  <Icon size={20} />
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm text-foreground">{meta.label}</span>
                  {isConnected && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-950/40 dark:border-green-700 dark:text-green-400">
                      <CheckCircle2 size={9} />
                      {conn?.platformHandle ?? "Connected"}
                    </span>
                  )}
                  {meta.pendingReview && !isConnected && (
                    <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-400">
                      Review pending · {meta.reviewWait}
                    </span>
                  )}
                </div>
                {meta.note && (
                  <p className="mt-0.5 text-xs text-text-muted">{meta.note}</p>
                )}
              </div>

              <div className="shrink-0 flex gap-2">
                {isConnected ? (
                  <DisconnectButton platform={id} />
                ) : (
                  <a
                    href={canConnect ? meta.connectPath : undefined}
                    aria-disabled={!canConnect}
                    className={[
                      "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      canConnect
                        ? "border-primary bg-primary text-white hover:opacity-90"
                        : "border-border text-text-muted cursor-not-allowed opacity-50 pointer-events-none",
                    ].join(" ")}
                  >
                    {meta.pendingReview ? "Connect when approved" : "Connect"}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
