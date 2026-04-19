# Pulse 100x Roadmap

> Updated 2026-04-19. Living doc. Scope held; hero chosen; shipping in slices.

## Positioning

**Pulse is your AI marketing team.** A content strategist, SEO analyst, copywriter, social scheduler, and brand analyst reporting to a single human operator. Not a toolkit. Not a dashboard. A team.

**Tagline candidates:**
- "Your AI marketing team. In a box."
- "The marketing team you couldn't afford to hire."
- "One operator. A full marketing org."

## Hero feature

**60-second brand audit onboarding.** A new tenant pastes their website URL and Pulse does the setup work a junior marketer would take 2 weeks to do: extracts brand voice + positioning, finds 5 competitors, identifies 20 SEO opportunities, generates 5 briefs, stages a 90-day content calendar. The dashboard lights up full of real data, not a blank slate.

Everything else in the product becomes "what your AI team has queued up for you."

## Supporting pillars (scope retained, each gets an upgrade)

1. **Content Machine** — blog writer evolves into full-distribution pipeline. One blog → 10 artifacts (Twitter/X thread, LinkedIn post, Instagram carousel script, TikTok hook, email, newsletter blurb, Reddit comment, YouTube short script). Same brand-voice + score engine.
2. **Publish Loop** — scheduled_posts table actually hits real platforms (Ayrshare or Buffer SDK). WordPress/Ghost REST export for blog. Resend for email. Today it's all Pulse-internal.
3. **AI Coach** — every score (platform, blog, keyword) gets a "fix this" button that drops recommended actions into the calendar. Dashboard aggregates into one "do this next" list.
4. **Inbound Data Connectors** — GA4, Meta Ads, Google Ads, HubSpot/CRM sync read-only analytics. Kills the manual-entry churn.
5. **Programmatic SEO Executor** — blueprint → batch-generate 50 linked pages. 80% of infra already exists.

## Ship order (aggressive but tractable)

### Slice 1 — Brand Audit MVP (this session, 1–2 commits)
- New route `/onboarding/audit` (authed, pre-dashboard gate).
- Server action `runBrandAudit(url)` — scrapes URL, extracts title/description/text sample, gpt-4.1 generates brand voice JSON + positioning JSON, writes to `tenants.settings`.
- UI: single URL input → progress log ("Crawling…", "Extracting voice…", "Writing positioning…", "Done") → redirect to dashboard.
- Signup gate: new tenant without brand_voice set → bounce to `/onboarding/audit`.
- Feature-flagged via `AUDIT_ONBOARDING` env var so we can ship and enable gradually.

**Why first:** fixes Day-1 time-to-value (2/10 → 8/10) with the fewest moving parts. Unblocks every other AI feature because voice + positioning are required inputs.

### Slice 2 — Competitor + Keyword auto-population (next session)
- Extend the audit: after voice/positioning, run SERP on brand name + top services → extract 3-5 competitors → insert into `competitors` table.
- Pull top-ranked keywords for each competitor → propose 20 tracked keywords → insert into `keyword_rankings`.
- Generate 5 content briefs from the intersection of brand positioning + competitor gaps → insert into `content_briefs`.

### Slice 3 — Content Machine (content multiplier)
- `src/lib/ai/multiply-content.ts` — takes a blog post, generates N distribution artifacts.
- "Distribute" button in blog editor → opens a multi-format preview → approve / edit / schedule each.
- New table `content_distributions (blog_post_id, format, content, status, scheduled_at)` — migration #027.

### Slice 4 — Publish Loop (real outbound)
- Ayrshare or Buffer SDK wrapper at `src/lib/integrations/social-publisher.ts`.
- WordPress + Ghost REST wrappers for blog.
- `/settings/integrations` page for tenant to connect their accounts (OAuth or API token).

### Slice 5 — AI Coach
- `src/lib/ai/coach.ts` — takes a score result + brand context, returns prescribed actions.
- New column `score_issues.recommended_action_id` linking to an actions table.
- Dashboard widget: "Top 3 things your team is working on" aggregates across all scores.

### Slice 6 — Inbound Data Connectors
- GA4, Meta Ads, Google Ads OAuth flows.
- Nightly cron (Vercel cron) to sync analytics → own_post_metrics / campaigns tables.
- Kill manual CSV imports.

### Slice 7 — Programmatic SEO Executor
- Extend `generate-programmatic-page.ts` to batch mode: blueprint → 50-page generation with inter-linking.
- Queue-based to stay under Vercel Hobby compute (or upgrade plan).

## Things that stay (no functionality removed)

All modules kept: intel-feed, platform-score, engagement, post-history, viral-trends, ads-tracker, leads, content-vault, seo-tracker, competition, content-briefs, ai-content, own-analytics, weekly-report, trend-scouts. Each improves through supporting pillars (auto-populated by audit, coached by AI Coach, published via Publish Loop, powered by data connectors).

## Marketing surface (parallel track)

- Public landing at `/` (currently redirects to /dashboard — kills acquisition).
- Pricing page with 3 tiers.
- Demo signup flow (fake brand data) so tourists can explore before creating an account.

Out of this doc's scope — needs design pass. Track separately.

## Success metrics

- **Activation:** % of new tenants that hit /dashboard with data populated. Target: 85% (vs. ~5% today — anyone who doesn't manually set up).
- **Time-to-first-blog:** new tenant → first generated blog. Target: 5 minutes. Today: unbounded (blocked by manual setup).
- **Retention day 7:** tenants with ≥3 logins in week 1. Target: 50%. No baseline yet.
