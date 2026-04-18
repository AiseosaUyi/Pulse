// Platform classifier for content-vault URL intake. Centralized so the
// orchestrator (actions/saved-content) + UI copy can agree on which
// platforms we can *extract* bytes from vs ones we save as links only.
//
// TikTok is always extractable via tikwm (free public API, no config).
// Instagram + YouTube + Twitter/X + Facebook become extractable when a
// self-hosted cobalt instance is configured via COBALT_API_URL.
// LinkedIn is deliberately never extracted — LinkedIn aggressively
// suspends accounts tied to scraped content, so we save the link and
// let the user download manually.

export type PlatformSlug =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "twitter"
  | "facebook"
  | "linkedin"
  | "manual";

export interface PlatformDetection {
  platform: PlatformSlug;
  /** True when some extractor is wired AND configured right now. */
  canExtract: boolean;
  /** Which backend will handle it. */
  extractor: "tikwm" | "cobalt" | null;
  /** Short copy we show in the UI when saving as link only. */
  linkOnlyReason?: string;
}

interface HostRule {
  hostMatch: (host: string) => boolean;
  platform: PlatformSlug;
}

const HOST_RULES: HostRule[] = [
  { hostMatch: (h) => h.endsWith("tiktok.com"), platform: "tiktok" },
  { hostMatch: (h) => h.endsWith("instagram.com"), platform: "instagram" },
  { hostMatch: (h) => h === "youtu.be" || h.endsWith("youtube.com"), platform: "youtube" },
  { hostMatch: (h) => h === "x.com" || h.endsWith("twitter.com"), platform: "twitter" },
  { hostMatch: (h) => h.endsWith("facebook.com") || h === "fb.watch", platform: "facebook" },
  { hostMatch: (h) => h.endsWith("linkedin.com"), platform: "linkedin" },
];

function cobaltConfigured(): boolean {
  return !!process.env.COBALT_API_URL;
}

export function detectPlatform(rawUrl: string): PlatformDetection {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return {
      platform: "manual",
      canExtract: false,
      extractor: null,
      linkOnlyReason: "Unknown source. Saved as a link.",
    };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  for (const rule of HOST_RULES) {
    if (!rule.hostMatch(host)) continue;
    const p = rule.platform;

    // TikTok: always via tikwm, no config required.
    if (p === "tiktok") {
      return { platform: p, canExtract: true, extractor: "tikwm" };
    }

    // LinkedIn: deliberate opt-out to protect the user's account.
    if (p === "linkedin") {
      return {
        platform: p,
        canExtract: false,
        extractor: null,
        linkOnlyReason:
          "LinkedIn extraction is disabled to protect your account. Saved as a link.",
      };
    }

    // Instagram, YouTube, Twitter, Facebook → cobalt when configured.
    if (cobaltConfigured()) {
      return { platform: p, canExtract: true, extractor: "cobalt" };
    }
    return {
      platform: p,
      canExtract: false,
      extractor: null,
      linkOnlyReason: `${displayName(p)} extraction is unavailable (set COBALT_API_URL to enable). Saved as a link.`,
    };
  }

  return {
    platform: "manual",
    canExtract: false,
    extractor: null,
    linkOnlyReason: "Unknown source. Saved as a link.",
  };
}

function displayName(p: PlatformSlug): string {
  switch (p) {
    case "tiktok":
      return "TikTok";
    case "instagram":
      return "Instagram";
    case "youtube":
      return "YouTube";
    case "twitter":
      return "Twitter/X";
    case "facebook":
      return "Facebook";
    case "linkedin":
      return "LinkedIn";
    default:
      return "This platform";
  }
}
