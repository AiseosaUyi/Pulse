// Single source of truth for every /api/v1 endpoint. GET /api/v1/manifest
// serializes this array; docs/API-V1.md is written by hand from it and
// must be kept in sync manually. Append to this array — never rewrite
// past entries' `path`/`method` — as later PRs (Part 3: notifications +
// mobile approvals) land.

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

  // Intelligence
  { method: "GET", path: "/api/v1/intel/feed", scope: "intel:read", description: "Competitor intel signals (filter contentType/since)." },
  { method: "GET", path: "/api/v1/trends", scope: "intel:read", description: "Current viral/trend signals (filter platform/source)." },
  { method: "GET", path: "/api/v1/competitors", scope: "intel:read", description: "The tenant's tracked competitor set (static snapshot, no computed deltas)." },

  // SEO
  { method: "GET", path: "/api/v1/seo/recommendations", scope: "seo:read", description: "Open SEO recommendations, ranked by score (default status=surfaced)." },
  { method: "GET", path: "/api/v1/seo/rank", scope: "seo:read", description: "Tracked-keyword ranks." },
  { method: "GET", path: "/api/v1/seo/topical-map", scope: "seo:read", description: "The tenant's latest generated topical map (pre-stored, no LLM call on read)." },

  // Analytics
  { method: "GET", path: "/api/v1/analytics/overview", scope: "analytics:read", description: "Dashboard KPIs: reach/engagement this week vs last, prospect pipeline counts, active campaign spend, connected platforms." },
  { method: "GET", path: "/api/v1/analytics/posts", scope: "analytics:read", description: "Per-post engagement metrics (filter platform/since) — reads own_post_metrics, the same table publish:write's metrics endpoint writes to." },
  { method: "GET", path: "/api/v1/weekly-review", scope: "analytics:read", description: "The latest generated weekly business-review narrative (pre-stored, no LLM call on read)." },

  // Content
  { method: "GET", path: "/api/v1/briefs", scope: "content:read", description: "List content briefs (filter status)." },
  { method: "POST", path: "/api/v1/briefs", scope: "content:write", description: "Generate a content brief from an existing intel card." },
  { method: "GET", path: "/api/v1/content-calendar", scope: "content:read", description: "Upcoming content_slots for the tenant (individual-persona feature — allowlist-gated, same as the app)." },
  { method: "GET", path: "/api/v1/blog-posts", scope: "content:read", description: "List blog posts (filter status)." },
  { method: "GET", path: "/api/v1/blog-posts/:id", scope: "content:read", description: "Single blog post + its latest version." },
  { method: "POST", path: "/api/v1/blog-posts", scope: "content:write", description: "Create a draft blog post (title and/or targetKeyword and/or extraContext — at least one required). AI-generated." },
  { method: "POST", path: "/api/v1/captions/compose", scope: "content:write", description: "AI-compose a multi-platform caption take from a source URL or angle." },

  // Notifications / mobile approvals (Part 3)
  { method: "POST", path: "/api/v1/briefings/send", scope: "publish:write | content:write", description: "Send a scheduled post or content brief for human approval via a signed link, delivered by email or WhatsApp. Scope depends on targetType." },
  { method: "GET", path: "/api/v1/approvals/pending", scope: "content:read", description: "Approval requests sent but not yet approved/rejected/expired." },
  { method: "POST", path: "/api/v1/approvals/:token/approve", scope: null, description: "Approve a pending request. Auth is the signed token itself, not a bearer tenant_api_token — called only by the public /approve/[token] page." },
  { method: "POST", path: "/api/v1/approvals/:token/reject", scope: null, description: "Reject a pending request, with an optional reason. Same token-in-path auth as approve." },
];
