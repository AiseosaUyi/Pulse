# PULSE — API Integration Pricing & Cost Optimization Guide

*Last updated: April 13, 2026*
*Context: 4 team members, 2 startups (Gruve + Sippy), Nigeria-based*

---

## Free APIs (Connect These First — $0/month)

These cover ~60% of PULSE functionality with real data.

| API/Service | What it powers in PULSE | Rate limits | How to get access |
|---|---|---|---|
| **Instagram Graph API** | Platform score, engagement inbox, post history, DMs, stories | 200 calls/hour | Create Meta App at developers.facebook.com. Need IG Business account |
| **TikTok Display API** | Followers, engagement, video stats, content performance | Free for approved devs | Apply at developers.tiktok.com |
| **LinkedIn Page API** | Company page followers, post impressions, engagement | Admin of company page required | Apply at linkedin.com/developers. Only works for pages you admin |
| **Meta Ads API** | Ads tracker: spend, impressions, ROAS, conversions | Tied to ad account | Included with any Meta ad account |
| **Google Search Console API** | SEO keyword rankings, positions, clicks, indexed pages, impressions | No practical limit | Verify site ownership at search.google.com/search-console |
| **Google Analytics 4 API** | Organic traffic, audience data, conversions, behavior | No practical limit | Set up GA4 property at analytics.google.com |
| **YouTube Data API** | Content vault trending videos | 10K quota units/day | Enable at console.cloud.google.com |
| **Supabase (free tier)** | Database, auth, multi-tenancy, RLS | 500MB DB, 50K auth users, 2GB storage | supabase.com — more than enough to start |
| **Vercel (free tier)** | Hosting, deployment, preview URLs | 100GB bandwidth, 1 project | vercel.com |
| **Resend (free tier)** | Weekly report emails, notifications | 3K emails/month (100 weekly reports) | resend.com |

---

## Essential Paid Stack ($300-400/month)

Add these to get to ~90% functionality.

| Service | Monthly cost | What it powers | Why you need it |
|---|---|---|---|
| **Twitter/X API (Basic)** | $100 | Tweet data, engagement, mentions, DM access | Free tier is read-only. Basic lets you read DMs and post |
| **Claude API (Anthropic)** | $50-150 | AI content engine, blog writer, content suggestions | Pay-per-use with prompt caching. 2 startups × 5 posts/day ≈ $50-150 |
| **Semrush (Pro)** | $130 | SEO command center: keyword research, SERP analysis, competitor data, backlinks, topical maps | The one paid SEO tool you need. Covers keywords, competitors, programmatic SEO data |
| **Resend (Pro)** | $20 | Reliable email for weekly reports to full team | Upgrade from free when team grows |

---

## Nice to Have (add when revenue justifies)

| Service | Monthly cost | What it powers | When to add |
|---|---|---|---|
| **Buffer (Essentials)** | $60 | Auto-schedule posts across all platforms from PULSE | When posting 3+ times/day per platform |
| **Ahrefs (Lite)** | $129 | Deeper backlink analysis, content gap data | When SEO is a serious growth channel |
| **Brand24** | $79 | Real-time social listening, auto trend detection | When Viral Trends module needs to be automated |
| **HubSpot (Starter)** | $20 | CRM sync for leads module | When lead volume exceeds manual tracking |
| **Cloudinary** | $89 | Advanced image/video processing at scale | When content vault handles 100+ videos/month |

---

## Cost Reduction: The $0/month Stack

Replace every paid service with a free alternative.

| Paid service | Free replacement | What you lose |
|---|---|---|
| **Claude API ($50-150/mo)** | **Ollama + Llama 3.1** (run locally, $0) | Slightly lower quality. Run on your laptop or a $5/mo VPS |
| **Semrush ($130/mo)** | **Google Search Console (free) + Ubersuggest free tier (3 searches/day)** | No competitor backlink data. But GSC gives YOUR rankings, positions, clicks — 70% of the SEO module |
| **Twitter/X Basic ($100/mo)** | **RSS feeds + Nitter (self-hosted, $0)** | No DM access. Can still read tweets, mentions, engagement. Post manually |
| **Resend Pro ($20/mo)** | **Resend free tier ($0)** | 3K vs unlimited emails. 3K is more than enough for 4 people |
| **Buffer ($60/mo)** | **Post manually** | No auto-scheduling. PULSE tells you WHAT and WHEN, you copy-paste and post |

**Total: $0/month — gets you ~75% of PULSE on real data.**

---

## What to Do Manually (Zero Cost, Minimal Effort)

| Module | Manual workflow | Daily time |
|---|---|---|
| **Engagement Inbox** | Check each platform's native inbox. Log important interactions in PULSE | 15 min/day |
| **Content Vault** | Save memes/videos to shared folder. Log in PULSE | 5 min per save |
| **Leads & Outreach** | Type leads into PULSE directly | Already doing this |
| **Weekly Report** | Auto-generated from data entered that week | 0 min (auto) |
| **Trend detection** | Follow 5-10 niche accounts. When you spot a trend, log it | 10 min/day |

---

## What to Skip Entirely (No Value Loss)

| Feature | Why skip |
|---|---|
| **Automated DM reading** | Privacy issues. Platforms block it. Check DMs natively |
| **Auto-posting** | 2 startups × 1-2 posts/day = 5 min manual posting. Buffer is overkill |
| **Real-time trend monitoring** | Brand24/Sprout are for brands with 1000+ daily mentions. Not you yet |
| **Backlink monitoring** | At DA 18-28, focus on creating content. Check monthly on free Ahrefs Webmaster Tools |
| **LinkedIn Sales Navigator** | $99/mo for lead discovery. Your leads are event partners, not LinkedIn sales targets |
| **Hootsuite ($449/mo)** | Overkill. Buffer at $60 does the same for small teams |
| **Twitter/X Pro ($5,000/mo)** | Basic at $100 is more than enough for 2 accounts |
| **Moz ($99/mo)** | Redundant if you have Semrush |
| **Twilio SMS** | Email notifications cover this. SMS is overkill for 4 team members |

---

## LinkedIn — What Actually Works

LinkedIn is the hardest platform to integrate. Here's the reality:

| Method | Works? | Details |
|---|---|---|
| **LinkedIn Page API (free)** | YES | Gives followers, post impressions, clicks, engagement. Must be admin of company page. Apply at linkedin.com/developers |
| **LinkedIn Marketing API** | YES | Requires partner approval (2-4 weeks). Gives ad analytics. Free once approved |
| **Cookie scraping** | NO | Works ~2 hours, then LinkedIn blocks your account. Not sustainable |
| **Phantom Buster / Captain Data** | SOMETIMES | Third-party scrapers, $69-99/mo. Break every LinkedIn update |
| **LinkedIn Sales Navigator** | MANUAL ONLY | No real API. $99/mo. Copy-paste leads into PULSE manually |

**Recommendation:** Use the free LinkedIn Page API for Gruve and Sippy company pages. Skip DMs and individual profiles — handle those in LinkedIn itself. Manually enter LinkedIn leads.

---

## Recommended Rollout Plan

### Month 1: $0/month
- Deploy PULSE on Vercel free tier
- Connect free APIs: Instagram Graph, TikTok Display, Google Search Console, Meta Ads, LinkedIn Page API
- Set up Supabase for real data storage
- Dashboard, Platform Score, Ads Tracker, and basic SEO Tracker run on real numbers

### Month 2: +$170/month ($170 total)
- Add Claude API ($50-150) for AI Content Engine
- Add Resend Pro ($20) for Weekly Report emails
- Content suggestions and reports become real

### Month 3: +$230/month ($400 total)
- Add Twitter/X Basic ($100) for full Twitter engagement
- Add Semrush Pro ($130) for complete SEO Command Center
- All modules now functional with real data (~90% coverage)

### Month 6+: +$200-400/month ($600-800 total)
- Add Buffer ($60) if posting volume increases
- Add Ahrefs ($129) if SEO becomes primary growth channel
- Add Brand24 ($79) if you need automated trend detection

---

## Total Cost Summary

| Tier | Monthly | What works |
|---|---|---|
| **Free** | $0 | 75% of PULSE — dashboard, platform stats, ads, basic SEO, manual everything else |
| **Starter** | $170 | + AI content engine + email reports |
| **Growth** | $400 | + Twitter integration + full SEO command center (90% functional) |
| **Full power** | $800-1,200 | Everything automated. Every module on real data |

**For context:** $400/month is less than hiring a part-time marketing intern, and PULSE runs 24/7 for both Gruve and Sippy simultaneously.
