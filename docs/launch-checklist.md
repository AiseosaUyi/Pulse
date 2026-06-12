# Pulse × Sippy — Launch Checklist

Everything below was built so it stays dormant until you turn it on — nothing
existing was changed. Work top to bottom. Focus tenant: **`sippy`** (everything
also works for Gruve and any future workspace).

---

## 1. Run the database migrations

Open Supabase → your project → **SQL Editor**. Open each file from
`supabase/migrations/`, paste its contents, and click **Run**. Do them in order.
(You only need the ones not already applied — if one errors with "already
exists", it's done; move on.)

- [ ] `052_topical_maps.sql`
- [ ] `053_search_console.sql`
- [ ] `054_ai_visibility.sql`
- [ ] `055_programmatic_publish.sql`
- [ ] `056_authors.sql`
- [ ] `057_attribution_and_engagement_sync.sql`
- [ ] `058_channels_graphics_attribution.sql`
- [ ] `059_platform_discovery.sql`

Quick check: in the SQL editor run `select count(*) from orders;` — it should
return `0` with no error.

---

## 2. Get the accounts / keys you'll need

Skip any you already have. For each, the site to go to, what to grab, and where
it goes.

### a. Instagram (to publish + read comments/DMs) — **required for the main flow**
- Site: the **Instagram app** → Settings → **Account type** → switch Sippy to
  **Business** or **Creator**.
- Then at **business.facebook.com**, link that Instagram account to a **Facebook Page**.
- You don't copy any key — you'll click "Connect" inside Pulse (step 4).

### b. Google Analytics 4 (to see website traffic)
- Site: **console.cloud.google.com** → create a project → **APIs & Services →
  Credentials → Create credentials → Service account** → create a **JSON key** and download it.
- Site: **analytics.google.com** → Admin → Property Access Management → add that
  service account's email as a **Viewer**. Also copy your **Property ID** (Admin →
  Property Settings, a number like `123456789`).
- You'll paste the Property ID + the JSON file contents inside Pulse (step 4).

### c. WhatsApp (to message customers + send weekend deals)
- Site: **developers.facebook.com** → My Apps → Create App → add the **WhatsApp** product.
- From there copy: the **Phone number ID** and a **Permanent access token** (system user token).
- Pick any secret word as your **Verify token** (you choose it; you'll use the same one in steps 3 and 5).
- Business verification: **business.facebook.com → Security Center** (this takes
  a few weeks — start it now).

### d. TikTok (publishing) — start early, it has a review wait
- Site: **developers.tiktok.com** → register an app → submit for review.
- Nothing to paste yet; note the date you submitted: ____________

### e. Already-configured services (just confirm they still work)
- **Serper** (search rankings) — key at **serper.dev** if it ever needs renewing.
- **Apify** (scraping) — **apify.com** console for usage/billing.
- **Brevo** (emails) — **brevo.com**; pick an inbox to receive system alerts (step 3).

---

## 3. Set environment variables (Vercel)

Site: **vercel.com** → your project → **Settings → Environment Variables**. Add:

- [ ] `CRON_ALERT_EMAIL` — the email that should get "a background job is failing" alerts.
- [ ] `NEXT_PUBLIC_APP_URL` — your live app URL (e.g. `https://app.yoursite.com`). Probably already set; it must be correct or tracked links won't work.
- [ ] `WHATSAPP_VERIFY_TOKEN` — the secret word you chose in 2c.

Redeploy after adding them.

---

## 4. Connect things inside Pulse (click, no code)

In the app, go to **Settings → Integrations**:

- [ ] **Connect Instagram** (Composio) — this is the one thing that unlocks
      publishing and the comment/DM inbox. Until it's connected, those stay idle.
- [ ] **Add GA4** — paste the Property ID and the service-account JSON from 2b.
- [ ] **Generate an API token** — you'll give this to your developer for the
      storefront (step 5).

Then:

- [ ] **Settings → Discovery sources** — add the platforms you want to mine for
      leads (e.g. drinks sites). Gruve already has its ticketing sites built in.
- [ ] **Connect WhatsApp** — save the Phone number ID + access token from 2c
      (per workspace, so Sippy and Gruve can each have their own number).

---

## 5. Wire the storefront (one task for your developer — separate repo)

So that website orders show up automatically and are tied to the post that drove them:

- [ ] On checkout, sippy.life should send a request to
      `POST https://<your-app>/api/orders/webhook`
      with header `Authorization: Bearer <the API token from step 4>`
      and a JSON body with the order amount + campaign tag.
- [ ] Carry the `utm_campaign` from the link the customer clicked through to checkout.
- [ ] (WhatsApp / phone / in-person orders don't need this — log those by hand in
      **Growth → Orders → Log order**.)

---

## 6. WhatsApp webhook (in the Meta app dashboard)

Site: **developers.facebook.com** → your app → WhatsApp → Configuration:

- [ ] Callback URL: `https://<your-app>/api/integrations/whatsapp`
- [ ] Verify token: the same secret word from 2c / step 3.
- [ ] Subscribe to **messages**.
- [ ] Create and get approval for at least one **message template** (needed to send
      broadcasts to people who haven't messaged you in the last 24 hours).

---

## 7. Test it once (in order)

1. **System health** — open **Settings → System health**. After a day, every job should be green.
2. **Publish** — schedule one Sippy video to Instagram with a caption that has a link; publish it. Check the post is live and shows up in **Post history** with a link.
3. **Click** — open that link yourself; it should redirect to the destination.
4. **Order** — place a test order on the site (or use **Growth → Orders → Log order**); it should appear under **Orders**, tied to the campaign.
5. **Inbox** — let a real comment/DM come in; in **Engagement inbox**, generate a reply, approve it, and confirm it sends.
6. **WhatsApp** — message the number; it should appear in the inbox. Make a broadcast list and send a weekend deal.
7. **Weekly review** — check **Weekly report** shows the posts → clicks → orders summary.

---

## 7b. Video studio (Seedance via PicsArt) — dormant until you add the key

The video engine is built and ships dormant. To turn it on:

- [ ] Apply migrations **`060_video_engine.sql`** and **`061_video_status_rpc.sql`** (Supabase SQL Editor).
- [ ] Create a **PicsArt gen-ai** account at **picsart.com/api**, top up **credits**, and add `PICSART_API_KEY` (and optionally `PICSART_CREDIT_USD`, default `0.005`) in Vercel.
- [ ] The new `video-maintenance` cron makes **13** scheduled jobs — confirm your Vercel plan allows it.
- [ ] Use it: in **AI Content → video plans**, open a plan and click **Create video** → review the storyboard in **Video studio** → **Approve** → **Start generation**. Define reusable people under **Video studio → Characters** first (3–9 reference images + an identity prompt) for consistent faces.
- [ ] Until `PICSART_API_KEY` is set, storyboards still generate (text only, no spend) but “Start generation” reports the provider isn’t configured.
- [ ] **Note:** the PicsArt endpoint paths in `src/lib/video/providers/picsart.ts` are coded to the documented API surface; confirm them against your live account once the key exists (they’re centralized in one `ENDPOINTS` object).

## 8. Decisions only you can make

- [ ] **Vercel plan** — there are now 12 scheduled jobs. Confirm your plan allows
      that many cron jobs (Hobby is limited; Pro is fine). If not, we drop the least important.
- [ ] **Old unused features** — Ads Critic, AI Coach, and a couple of half-wired
      integrations are still in the app but unused. I left them alone (you said
      don't break anything). Tell me if you want them removed in a later pass.
- [ ] **Reviews started?** — confirm TikTok (2d) and WhatsApp business verification
      (2c) are in progress, since they take weeks.
