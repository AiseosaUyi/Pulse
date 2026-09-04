// Single source of truth for every /api/v1 endpoint. GET /api/v1/manifest
// serializes this array; docs/API-V1.md is written by hand from it and
// must be kept in sync manually. Append to this array — never rewrite
// past entries' `path`/`method` — as later PRs (Part 3: notifications +
// mobile approvals) land.

export interface ManifestEntry {
  method: "GET" | "POST" | "PATCH";
  path: string;
  scope: string | null;
  description: string;
}

export const API_V1_MANIFEST: ManifestEntry[] = [
  // Meta
  { method: "GET", path: "/api/v1/me", scope: null, description: "Resolve the token to its tenant, brand voice/positioning, and granted scopes." },
  { method: "POST", path: "/api/v1/me", scope: "admin", description: "Write brand voice and/or positioning for the tenant (at least one required)." },
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
  { method: "POST", path: "/api/v1/prospects/:id/quality", scope: "sales:write", description: "Set a prospect's quality tier (unscored/hot/warm/cold/dead) — independent of pipeline status." },
  { method: "POST", path: "/api/v1/prospects/:id/duplicate", scope: "sales:write", description: "Mark a prospect as a duplicate of another (duplicateOfId), or unmark by passing null. Marking also drops status to dismissed; never deletes a row." },

  // Publishing — closes the loop for the browser-driven social manager
  { method: "GET", path: "/api/v1/publish-queue", scope: "publish:read", description: "Scheduled posts awaiting manual publishing (filter platform/status/due)." },
  { method: "GET", path: "/api/v1/media/*path", scope: "publish:read", description: "Resolve a scheduled post's media path (R2 key) to a downloadable URL." },
  { method: "POST", path: "/api/v1/posts/:id/published", scope: "publish:write", description: "Record a successful manual post (platformPostId, platformPostUrl, postedAt)." },
  { method: "POST", path: "/api/v1/posts/:id/metrics", scope: "publish:write", description: "Record engagement observed on-platform (upserts own_post_metrics)." },

  // Engagement
  { method: "GET", path: "/api/v1/inbox", scope: "engage:read", description: "Comments/DMs needing a response (filter platform, unanswered)." },
  { method: "POST", path: "/api/v1/inbox", scope: "engage:write", description: "Upsert an observed comment/DM (dedup key: platform + externalId). Optionally attach why/body/proposedReply/status/prospectId in the same call — each omitted independently on a repeat upsert, never reset to null. The write half of the shared inbox — an agent working the real platform in a browser puts what it sees here." },
  { method: "PATCH", path: "/api/v1/inbox/:id", scope: "engage:write", description: "Edit an inbox item: proposedReply, priority, dueAt, assignedTo, externalUrl." },
  { method: "POST", path: "/api/v1/inbox/:id/status", scope: "engage:write", description: "Set an inbox item's status: open/snoozed/resolved/dismissed, with an optional note or snooze time." },
  { method: "POST", path: "/api/v1/inbox/:id/sent-reply", scope: "engage:write", description: "Record what was actually sent for a reply posted outside Pulse (e.g. through a browser session). Writes sent_body, marks resolved." },
  { method: "POST", path: "/api/v1/inbox/:id/reply-draft", scope: "engage:write", description: "Generate an on-brand reply draft for an inbox item." },
  { method: "POST", path: "/api/v1/inbox/:id/replied", scope: "engage:write", description: "Mark an inbox item handled. Alias for POST /api/v1/inbox/:id/status {status:'resolved'} — kept for existing callers." },
  { method: "GET", path: "/api/v1/action-queue", scope: "engage:read", description: "The unified attention board: needs a reply, needs a decision, follow-ups due, going cold, opportunities. Filter status/kind/priority/assignedTo/platform/since." },
  { method: "GET", path: "/api/v1/action-items", scope: "engage:read", description: "Non-message action items (decisions, escalations, opportunities, chores) — filter same as action-queue." },
  { method: "POST", path: "/api/v1/action-items", scope: "engage:write", description: "Upsert a non-message action item by dedupeKey." },
  { method: "PATCH", path: "/api/v1/action-items/:id", scope: "engage:write", description: "Edit an action item: proposedReply, priority, dueAt, assignedTo, externalUrl." },
  { method: "POST", path: "/api/v1/action-items/:id/status", scope: "engage:write", description: "Set an action item's status: open/snoozed/resolved/dismissed, with an optional note or snooze time." },
  { method: "POST", path: "/api/v1/agent-runs", scope: "engage:write", description: "Open an agent run (agent name, optional surface). Returns runId." },
  { method: "POST", path: "/api/v1/agent-runs/:id/finish", scope: "engage:write", description: "Close an agent run with a summary." },

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
  { method: "GET", path: "/api/v1/analytics/ads/overview", scope: "analytics:read", description: "Aggregate ad-campaign totals: spend, revenue, ROAS, impressions/clicks/conversions, active vs total count." },
  { method: "GET", path: "/api/v1/analytics/ads", scope: "analytics:read", description: "Per-campaign detail (filter status) behind the ads/overview totals — platform, status, spend, revenue, ROAS, dates." },
  { method: "GET", path: "/api/v1/ads/accounts", scope: "analytics:read", description: "Real connected Meta/TikTok ad accounts for this tenant, with sync status." },
  { method: "GET", path: "/api/v1/ads/roas", scope: "analytics:read", description: "Blended ROAS: ad spend joined against Pulse's own order data (not the platform's self-reported ROAS), plus per-campaign breakdown with match confidence." },
  { method: "GET", path: "/api/v1/ads/competitors", scope: "intel:read", description: "Competitor ads discovered via Meta's Ad Library, longest-running first." },
  { method: "GET", path: "/api/v1/ads/budget-rules", scope: "analytics:read", description: "Ad budget guardrail automation rules." },
  { method: "POST", path: "/api/v1/ads/budget-rules", scope: "publish:write", description: "Create an ad budget guardrail rule (pause/reallocate on a metric threshold held for N days)." },
  { method: "GET", path: "/api/v1/ads/alerts", scope: "analytics:read", description: "Creative fatigue, delivery issues, and platform recommendations from connected ad accounts." },
  { method: "GET", path: "/api/v1/weekly-review", scope: "analytics:read", description: "The latest generated weekly business-review narrative (pre-stored, no LLM call on read)." },

  // Content
  { method: "GET", path: "/api/v1/briefs", scope: "content:read", description: "List content briefs (filter status)." },
  { method: "POST", path: "/api/v1/briefs", scope: "content:write", description: "Generate a content brief from an existing intel card." },
  { method: "GET", path: "/api/v1/content-calendar", scope: "content:read", description: "Upcoming content_slots for the tenant (individual-persona feature — allowlist-gated, same as the app)." },
  { method: "POST", path: "/api/v1/content-calendar", scope: "content:write", description: "Generate the next batch of content_slots (batchSize 1-10, default 10; optional one-off instruction) via the self-correcting generation loop." },
  { method: "GET", path: "/api/v1/blog-posts", scope: "content:read", description: "List blog posts (filter status)." },
  { method: "GET", path: "/api/v1/blog-posts/:id", scope: "content:read", description: "Single blog post + its latest version." },
  { method: "POST", path: "/api/v1/blog-posts", scope: "content:write", description: "Create a draft blog post (title and/or targetKeyword and/or extraContext — at least one required). AI-generated." },
  { method: "POST", path: "/api/v1/captions/compose", scope: "content:write", description: "AI-compose a multi-platform caption take from a source URL or angle." },
  { method: "POST", path: "/api/v1/spaces", scope: "content:write", description: "Start an X/Twitter Space capture: creates a saved_content row and returns an R2 presigned upload URL. Used by scripts/space-capture/download_space.sh, which extracts the audio locally (a logged-in X session + long-running download, so it can't run server-side)." },
  { method: "POST", path: "/api/v1/spaces/:captureId/complete", scope: "content:write", description: "Mark a Space capture extracted once the mp3 PUT to the presigned URL has finished." },

  // Notifications / mobile approvals (Part 3)
  { method: "POST", path: "/api/v1/briefings/send", scope: "publish:write | content:write", description: "Send a scheduled post or content brief for human approval via a signed link, delivered by email or WhatsApp. Scope depends on targetType." },
  { method: "GET", path: "/api/v1/approvals/pending", scope: "content:read", description: "Approval requests sent but not yet approved/rejected/expired." },
  { method: "POST", path: "/api/v1/approvals/:token/approve", scope: null, description: "Approve a pending request. Auth is the signed token itself, not a bearer tenant_api_token — called only by the public /approve/[token] page." },
  { method: "POST", path: "/api/v1/approvals/:token/reject", scope: null, description: "Reject a pending request, with an optional reason. Same token-in-path auth as approve." },
];
