// Single source of truth for every /api/v1 endpoint. GET /api/v1/manifest
// serializes this array; docs/API-V1.md is written by hand from it and
// must be kept in sync manually. Append to this array — never rewrite
// past entries' `path`/`method` — as later PRs (Publishing, Engagement,
// Content, SEO, Intel, Analytics) land.

export interface ManifestEntry {
  method: "GET" | "POST";
  path: string;
  scope: string | null;
  description: string;
}

export const API_V1_MANIFEST: ManifestEntry[] = [
  // Meta
  { method: "GET", path: "/api/v1/me", scope: null, description: "Resolve the token to its tenant, brand voice/positioning, and granted scopes." },
  { method: "GET", path: "/api/v1/manifest", scope: null, description: "This list." },

  // Sales / outbound
  { method: "GET", path: "/api/v1/prospects", scope: "sales:read", description: "List/filter prospects (status, platform, qualificationScoreMin, search, limit, offset)." },
  { method: "POST", path: "/api/v1/prospects", scope: "sales:write", description: "Upsert a prospect by (platform, handle)." },
  { method: "GET", path: "/api/v1/prospects/:id", scope: "sales:read", description: "Single prospect + full conversation thread (DMs, inbound messages, notes, AI analyses)." },
  { method: "POST", path: "/api/v1/prospects/:id/draft-dm", scope: "sales:write", description: "AI-draft an outbound DM for a prospect and save it." },
  { method: "POST", path: "/api/v1/dms/:id/sent", scope: "sales:write", description: "Mark a drafted DM as sent; cascades the prospect's pipeline stage." },
  { method: "GET", path: "/api/v1/outbound/templates", scope: "sales:read", description: "List outbound templates (tenant-specific + global)." },
  { method: "GET", path: "/api/v1/outbound/filters", scope: "sales:read", description: "The tenant's outbound discovery filters (keywords, geo, competitors)." },
  { method: "POST", path: "/api/v1/event-leads", scope: "sales:write", description: "Capture an event/organizer lead from a known ticketing platform." },
  { method: "GET", path: "/api/v1/follow-ups", scope: "sales:read", description: "Today's outreach queue: overdue, due today, new replies, going cold." },
  { method: "POST", path: "/api/v1/prospects/:id/notes", scope: "sales:write", description: "Log a note on a prospect." },
  { method: "POST", path: "/api/v1/prospects/:id/stage", scope: "sales:write", description: "Transition a prospect's pipeline status, with a reason." },
  { method: "POST", path: "/api/v1/prospects/:id/inbound", scope: "sales:write", description: "Record an inbound reply observed on-platform." },

  // Publishing — closes the loop for the browser-driven social manager
  { method: "GET", path: "/api/v1/publish-queue", scope: "publish:read", description: "Scheduled posts awaiting manual publishing (filter platform/status/due)." },
  { method: "GET", path: "/api/v1/media/*path", scope: "publish:read", description: "Resolve a scheduled post's media path (R2 key) to a downloadable URL." },
  { method: "POST", path: "/api/v1/posts/:id/published", scope: "publish:write", description: "Record a successful manual post (platformPostId, platformPostUrl, postedAt)." },
  { method: "POST", path: "/api/v1/posts/:id/metrics", scope: "publish:write", description: "Record engagement observed on-platform (upserts own_post_metrics)." },

  // Engagement
  { method: "GET", path: "/api/v1/inbox", scope: "engage:read", description: "Comments/DMs needing a response (filter platform, unanswered)." },
  { method: "POST", path: "/api/v1/inbox/:id/reply-draft", scope: "engage:write", description: "Generate an on-brand reply draft for an inbox item." },
  { method: "POST", path: "/api/v1/inbox/:id/replied", scope: "engage:write", description: "Mark an inbox item handled." },
];
