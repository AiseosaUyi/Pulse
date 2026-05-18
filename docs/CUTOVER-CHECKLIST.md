# Cutover checklist — Pulse ↔ Gruve SEO go-live

One coordinated window (~45–60 min), both teams live on **Discord**.
Run top-to-bottom; do not skip a gate. Commands prefixed `!` are run by
Pulse on a trusted machine — never paste keys/secrets into Discord/CI.

Pre-reqs (before the window):
- [ ] A9 window agreed (date/time/owners) — **this is the only gate**.
- [ ] Pulse Vercel plan confirmed (Pro if `*/5` publish-sweep cron is
      kept; else it's already switched to hourly).
- [ ] Gruve has sent the GSC service-account **email** (non-secret).
- [ ] Migrations 043–049 applied to Supabase.
- [ ] PR #1 (`feat/ai-seo-os`) reviewed; Pack C spec PR diffed.

## Sequence (owner)

1. **Gruve** — push/deploy, set go-live env, configure Contentful
   webhook → `https://www.gruve.events/api/revalidate` +
   `CONTENTFUL_WEBHOOK_SECRET`. ✋ gate: Gruve confirms deployed.

2. **Exchange window (age / Discord)** — fingerprints verified out of
   band first (last 8 chars each way).
   - Pulse → Gruve (the 2 secrets):
     ```
     ! P=$(openssl rand -hex 32); B=$(openssl rand -hex 32); \
       printf 'PREVIEW_SHARED_SECRET=%s\nPULSE_BEACON_SECRET=%s\n' "$P" "$B" \
       | age -r age10fhgd8ww67mhfhxfxsxrlpcv53lcqjylqkcnqd708j77qgd9cvjss0m5gg -a
     ```
     Post blob in Discord. Keep `$P`/`$B` for step 3.
   - Gruve → Pulse: encrypted CMA token blob + GSC service-account JSON
     blob (both to Pulse's age pubkey).
   - Pulse decrypts:
     ```
     ! age -d -i ~/pulse-age-key.txt        # paste CMA blob, Ctrl-D
     ! age -d -i ~/pulse-age-key.txt -o gsc-sa.json   # GSC JSON
     ```

3. **Pulse** — set Vercel **production** env, then redeploy:
   `CONTENTFUL_CMA_TOKEN` (decrypted), `CONTENTFUL_SPACE_ID=nc7eiymdfagh`,
   `CONTENTFUL_ENVIRONMENT=master`, `CONTENTFUL_DEFAULT_LOCALE=en-US`,
   `PREVIEW_SHARED_SECRET=$P`, `PULSE_BEACON_SECRET=$B`,
   `PULSE_JWKS_PRIVATE_KEY` (RS256 PKCS8 — generate on trusted machine:
   `! openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 | openssl pkcs8 -topk8 -nocrypt`),
   `PULSE_JWKS_KID=pulse-seo-1`, `GRUVE_API_BASE_URL=https://www.gruve.events`,
   `NEXT_PUBLIC_APP_URL=https://pulse-ashy-kappa.vercel.app`.
   GSC SA JSON stored as its own env/secret for the (later) connector.

4. **Pulse** — run the content-model migration (idempotent):
   ```
   ! CONTENTFUL_CMA_TOKEN='<decrypted>' CONTENTFUL_SPACE_ID=nc7eiymdfagh \
     CONTENTFUL_ENVIRONMENT=master pnpm tsx scripts/migrate-contentful-model.ts
   ```
   ✋ gate: verify the 7 fields on `gruveBlog` in the Contentful UI.

5. **Pulse** — smoke-test JWKS:
   `curl https://pulse-ashy-kappa.vercel.app/.well-known/jwks.json`
   ✋ gate: returns one RS256 key (not `{keys:[]}`).

6. **Gruve** — run `scripts/e2e-cert.sh` → ✋ gate: M1/M2/M3 green.

7. **Joint dry run** on `qa-pulse-e2e-2026-05`:
   - Pulse: open the post in blog-writer → preview pane (syncs draft to
     Contentful unpublished) → ✋ Gruve verifies CPA preview renders.
   - Pulse: approve → publish (runner upserts + publishes the entry).
   - Gruve: ✋ verify revalidate (<5s), render (RichText embedded
     asset), beacon round-trip.
   - Pulse: read back via C5 — **post-analytics-DB**, not blocking.

## Deferred / non-blocking (mutually agreed)
- `keyword_capture` — needs GSC connector (build post-window from
  authoritative §7–§8; A2 siteUrl string sent to Gruve before they
  authorize).
- `backlink_outreach` — Ahrefs, deferred indefinitely.
- `decay_alert` — shipped with `serp_confirmed:false`.
- C5 live data — until Gruve's analytics DB is provisioned.
- CSP enforce — post wallet-QA (Gruve side).

## Rollback
- Migration is additive (new fields only) — no destructive rollback
  needed; unset `CONTENTFUL_CMA_TOKEN` to halt publishing.
- Revert PR #1 / unset env to fully disable; nothing publishes without
  `CONTENTFUL_CMA_TOKEN`.
