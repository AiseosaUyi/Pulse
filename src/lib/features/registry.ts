// Per-workspace feature switches. Pulse has many modules; most workspaces use
// a few. A switched-off feature is hidden (sidebar, settings, its pages show a
// "switched off" note) but NOTHING is deleted: its tables, rows and URLs stay,
// and switching it back on brings everything back as it was.
//
// Stored in tenants.settings.features as { [key]: boolean }. A key that has
// never been set is decided once by `probes`: on if the workspace has any data
// for it (or if the check fails), off otherwise. Core jobs (Today, Leads,
// Conversations, Settings) are not switchable.

export type FeatureKey =
  | "autopilot"
  | "tasks"
  | "analytics"
  | "intel"
  | "seo"
  | "composer"
  | "content_library"
  | "video"
  | "content_calendar"
  | "schedule"
  | "broadcasts"
  | "post_history"
  | "platform_score"
  | "ads";

export interface FeatureProbe {
  table: string;
  tenantColumn: "tenant_slug" | "tenant_id" | "workspace";
}

export interface FeatureDef {
  key: FeatureKey;
  label: string;
  description: string;
  /** Route prefixes owned by this feature (pages show a note when off). */
  routes: string[];
  /** Any row in any of these means the workspace uses the feature. */
  probes: FeatureProbe[];
  /** Default when there is no data to look at (new workspace). */
  defaultOn: boolean;
}

const t = (table: string, tenantColumn: FeatureProbe["tenantColumn"] = "tenant_slug"): FeatureProbe => ({
  table,
  tenantColumn,
});

export const FEATURES: FeatureDef[] = [
  {
    key: "autopilot",
    label: "Email autopilot",
    description: "Drafts first emails and follow-ups, asks you to approve, sends from your mailbox.",
    routes: ["/autopilot"],
    probes: [t("outbound_dms")],
    defaultOn: true,
  },
  {
    key: "tasks",
    label: "Tasks",
    description: "Recurring habits and one-off tasks for the team, with streaks.",
    routes: ["/tasks"],
    probes: [t("tasks")],
    defaultOn: false,
  },
  {
    key: "analytics",
    label: "Social analytics",
    description: "Import and track your own posts' performance.",
    routes: ["/own-analytics", "/analytics", "/weekly-report"],
    probes: [t("own_post_metrics"), t("analytics_reports")],
    defaultOn: false,
  },
  {
    key: "intel",
    label: "Competitor intel",
    description: "Watch competitors and trends; get briefs from what works for them.",
    routes: ["/intel-feed", "/competition", "/signals", "/content-briefs", "/viral-trends"],
    probes: [t("competitors", "tenant_id"), t("intel_cards", "tenant_id"), t("trend_scouts")],
    defaultOn: false,
  },
  {
    key: "seo",
    label: "SEO and blog",
    description: "Keyword tracking, topical maps and AI blog posts.",
    routes: ["/seo-tracker"],
    probes: [t("blog_posts"), t("seo_posts")],
    defaultOn: false,
  },
  {
    key: "composer",
    label: "Composer",
    description: "Draft social posts with AI.",
    routes: ["/composer"],
    probes: [t("scheduled_posts"), t("content_distributions")],
    defaultOn: true,
  },
  {
    key: "content_library",
    label: "Content library and AI calendar",
    description: "Media vault, content pipeline and AI-planned calendar.",
    routes: ["/content-vault", "/ai-content"],
    probes: [t("content_items")],
    defaultOn: false,
  },
  {
    key: "video",
    label: "Video studio",
    description: "Generate short videos from your content.",
    routes: ["/video"],
    probes: [t("video_projects")],
    defaultOn: false,
  },
  {
    key: "content_calendar",
    label: "Topic calendar",
    description: "Daily topics with research briefs for solo creators.",
    routes: ["/content-calendar"],
    probes: [t("content_slots")],
    defaultOn: false,
  },
  {
    key: "schedule",
    label: "Post scheduler",
    description: "Schedule posts to connected social accounts.",
    routes: ["/schedule"],
    probes: [t("scheduled_posts")],
    defaultOn: false,
  },
  {
    key: "broadcasts",
    label: "WhatsApp broadcasts",
    description: "Send WhatsApp broadcasts to lists.",
    routes: ["/broadcasts"],
    probes: [t("broadcast_lists"), t("broadcast_messages")],
    defaultOn: false,
  },
  {
    key: "post_history",
    label: "Post history",
    description: "Everything you published, in one list.",
    routes: ["/post-history"],
    probes: [t("scheduled_posts"), t("own_post_metrics")],
    defaultOn: false,
  },
  {
    key: "platform_score",
    label: "Platform score",
    description: "A health score for each social platform.",
    routes: ["/platform-score"],
    probes: [t("own_post_metrics")],
    defaultOn: false,
  },
  {
    key: "ads",
    label: "Ads",
    description: "Ad critic and Meta/TikTok ad tracking.",
    routes: ["/ads-tracker"],
    probes: [t("ad_accounts"), t("campaigns")],
    defaultOn: false,
  },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);

export function featureDef(key: FeatureKey): FeatureDef {
  const f = FEATURES.find((x) => x.key === key);
  if (!f) throw new Error(`Unknown feature ${key}`);
  return f;
}

/** The feature that owns a path, if any. */
export function featureForPath(pathname: string): FeatureKey | null {
  for (const f of FEATURES) {
    if (f.routes.some((r) => pathname === r || pathname.startsWith(`${r}/`))) return f.key;
  }
  return null;
}

/** Merge stored switches with probe results for keys never set. Pure. */
export function resolveFeatures(
  stored: Partial<Record<FeatureKey, boolean>> | null | undefined,
  hasData: Partial<Record<FeatureKey, boolean | null>>
): Record<FeatureKey, boolean> {
  const out = {} as Record<FeatureKey, boolean>;
  for (const f of FEATURES) {
    const s = stored?.[f.key];
    if (typeof s === "boolean") {
      out[f.key] = s;
      continue;
    }
    const d = hasData[f.key];
    // null = the check failed: keep it on rather than hide someone's data.
    out[f.key] = d === null || d === true ? true : f.defaultOn;
  }
  return out;
}
