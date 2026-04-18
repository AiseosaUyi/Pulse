// Platform classifier for content-vault URL intake. Centralized so the
// orchestrator (actions/saved-content) + UI copy can agree on which
// platforms we can *extract* bytes from vs ones we save as links only.

export type ExtractablePlatform = "tiktok";
export type LinkOnlyPlatform =
  | "instagram"
  | "youtube"
  | "twitter"
  | "facebook"
  | "linkedin"
  | "manual";

export type PlatformSlug = ExtractablePlatform | LinkOnlyPlatform;

export interface PlatformDetection {
  platform: PlatformSlug;
  canExtract: boolean;
  /** Short copy we show in the UI when the user pastes a link-only URL. */
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

const LINK_ONLY_REASONS: Record<LinkOnlyPlatform, string> = {
  instagram:
    "Instagram extraction isn't wired up yet. Saved as a link for now.",
  youtube:
    "YouTube extraction isn't wired up yet. Saved as a link for now.",
  twitter:
    "Twitter/X extraction isn't wired up yet. Saved as a link for now.",
  facebook:
    "Facebook extraction isn't wired up yet. Saved as a link for now.",
  linkedin:
    "LinkedIn extraction isn't wired up yet. Saved as a link for now.",
  manual: "Unknown source. Saved as a link.",
};

export function detectPlatform(rawUrl: string): PlatformDetection {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return { platform: "manual", canExtract: false, linkOnlyReason: LINK_ONLY_REASONS.manual };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  for (const rule of HOST_RULES) {
    if (rule.hostMatch(host)) {
      const p = rule.platform;
      if (p === "tiktok") return { platform: p, canExtract: true };
      return {
        platform: p,
        canExtract: false,
        linkOnlyReason: LINK_ONLY_REASONS[p],
      };
    }
  }

  return { platform: "manual", canExtract: false, linkOnlyReason: LINK_ONLY_REASONS.manual };
}
