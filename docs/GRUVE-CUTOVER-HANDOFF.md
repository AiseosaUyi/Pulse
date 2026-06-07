# Gruve ↔ Pulse cutover handoff — what's done vs. what's left

_Last verified: 2026-06-07 by `pnpm tsx scripts/verify-gruve-contract.ts` (all green)._

## TL;DR — why it looked broken, and the real status

The Gruve→Pulse probe on 2026-06-06 saw the **login page at
`/.well-known/jwks.json`** and **404 at `/api/seo/beacon`**. That was **not a
code bug** — both routes exist and are correct; the `feat/ai-seo-os` branch
carrying them (plus the `/.well-known` auth exemption) simply **wasn't deployed**
to `pulse-ashy-kappa.vercel.app` at probe time.

The Pulse side is now **provably correct and self-verifiable without Gruve**:

- `scripts/verify-gruve-contract.ts` runs the **real key/secret material from
  `.env.local`** through the exact crypto chain Gruve verifies with (RS256
  service JWT ⇄ JWKS, HS256 preview JWT), plus checks every Contentful field and
  routing rule against the actual source. **All green.**
- Live-probed on a dev server: `/.well-known/jwks.json` and `/api/jwks` both
  serve one RS256 key (`kid=pulse-seo-1`); `/api/seo/beacon` returns 401 without
  a valid bearer; protected app routes still 307 → `/login`.

### Code changes made this pass (Pulse repo)
1. `src/lib/seo/gruve-client.ts` — `signGruveJwt()` now sets a **`jti`**
   (PULSE-ASK §1 requires it; Gruve's `guardPulse` uses it as the rate-limit
   key — without it every C5 read collapsed into one shared 60/min bucket).
2. `next.config.ts` — the `/.well-known/jwks.json → /api/jwks` rewrite now also
   lives in Next config (was vercel.json-only), so the canonical path resolves
   under `next dev` and isn't a platform-only black box.
3. `scripts/verify-gruve-contract.ts` — new permanent contract verifier
   (`pnpm verify:gruve`).

Everything else on both sides already matched (preview JWT, beacon shape,
Contentful field map + migration, the 6 C5 read APIs, revalidate-via-webhook).
The remaining work is **ops only** — deploy + the age secret exchange + Gruve
Vercel env. Nobody needs to touch integration logic.

---

## DECISION LOCKED: canonical Pulse host

**`pulse-ashy-kappa.vercel.app`** (no DNS work; matches the live deployment).
Consequence: Gruve must **explicitly set `PULSE_JWKS_URL`** to this host,
because Gruve's *code default* is `https://pulse.gruve.events/.well-known/jwks.json`.
Beacon URL and preview origin already default to this host in Gruve's
`.env.example`. If Pulse later moves to a branded `pulse.gruve.events`, only
these three Gruve env vars change.

---

## A. Gruve CTO — only you can do these (Gruve Vercel is not Pulse-owned)

### A1. Vercel env (Production **and** Preview)
```
PULSE_JWKS_URL=https://pulse-ashy-kappa.vercel.app/.well-known/jwks.json   # MUST override code default
PULSE_BEACON_URL=https://pulse-ashy-kappa.vercel.app/api/seo/beacon
PULSE_PREVIEW_ORIGIN=https://pulse-ashy-kappa.vercel.app
PREVIEW_SHARED_SECRET=<from Pulse, via age>
PULSE_BEACON_SECRET=<from Pulse, via age>
CONTENTFUL_WEBHOOK_SECRET=<you generate; also paste into the Contentful webhook>
```
`PULSE_JWT_ISSUER` (`pulse`) and `PULSE_JWT_AUDIENCE` (`gruve-api`) already
default correctly — leave them.

### A2. Contentful webhook
Point a webhook at `https://www.gruve.events/api/revalidate`, header
`X-Contentful-Webhook-Signature` = `CONTENTFUL_WEBHOOK_SECRET`, on Entry
publish / unpublish / archive / delete. (Pulse intentionally does **not** call
`/api/revalidate` — your webhook is the revalidation trigger.)

### A3. Mint + send the Contentful **CMA token** to Pulse (via age)
Encrypt to Pulse's age public key and post the blob in the agreed Discord
channel. Pulse cannot publish or run the model migration without it.

### A4. Deploy the SEO branch, then certify
```
BASE_URL=https://www.gruve.events CONTENTFUL_WEBHOOK_SECRET=… \
PREVIEW_SHARED_SECRET=… TEST_SLUG=qa-pulse-e2e-2026-05 \
bash scripts/e2e-cert.sh        # expect M1/M2/M3 green
```

### A5. ❓ Decision needed from you (blocks staging isolation)
Does Gruve **staging** use a separate Contentful environment/space from prod
`master`? If it's shared, Pulse test-publishes surface in production. Either
provision a staging Contentful environment, or we accept throwaway-slug +
unpublish for the dry run. (From `docs/CUTOVER-CHECKLIST.md`.)

---

## B. Pulse owner (you) — your side

The shared secrets are **already generated** and present in `.env.local`
(`PREVIEW_SHARED_SECRET`, `PULSE_BEACON_SECRET`, `PULSE_JWKS_PRIVATE_KEY`). You
do **not** need to regenerate — just exchange + deploy.

1. **Deploy** `feat/ai-seo-os` to `pulse-ashy-kappa.vercel.app` and set in the
   Pulse **Vercel** env (they're currently only in local `.env.local`):
   `PULSE_JWKS_PRIVATE_KEY`, `PULSE_JWKS_KID=pulse-seo-1`,
   `PREVIEW_SHARED_SECRET`, `PULSE_BEACON_SECRET`,
   `GRUVE_API_BASE_URL=https://www.gruve.events`,
   `GRUVE_PREVIEW_BASE_URL=https://www.gruve.events`.
2. **age-encrypt** `PREVIEW_SHARED_SECRET` + `PULSE_BEACON_SECRET` to Gruve's
   age key and post the blob (see `docs/SECURE-EXCHANGE.md`).
3. After receiving the CMA token from Gruve, set `CONTENTFUL_CMA_TOKEN`,
   `CONTENTFUL_SPACE_ID=nc7eiymdfagh`, `CONTENTFUL_ENVIRONMENT=master`,
   `CONTENTFUL_DEFAULT_LOCALE=en-US` in Vercel, then run the **idempotent**
   model migration **before any publish**:
   ```
   CONTENTFUL_CMA_TOKEN=… CONTENTFUL_SPACE_ID=nc7eiymdfagh \
   CONTENTFUL_ENVIRONMENT=master pnpm tsx scripts/migrate-contentful-model.ts
   ```
4. **Smoke-test post-deploy:**
   `curl https://pulse-ashy-kappa.vercel.app/.well-known/jwks.json`
   → must return a `keys` array with one RS256 key (not HTML, not `{keys:[]}`).

---

## C. Joint dry run (slug `qa-pulse-e2e-2026-05`)
1. Pulse opens the post → preview pane (syncs draft to Contentful unpublished)
   → Gruve verifies the preview iframe renders in Draft Mode (M2).
2. Pulse publishes → Gruve verifies revalidate (<5s), render (RichText embedded
   asset), beacon round-trip (M1/M3).
3. C5 read-back is **post-analytics-DB**, non-blocking for go-live.

## Anytime: re-prove the Pulse side
```
pnpm verify:gruve     # scripts/verify-gruve-contract.ts — all green = Pulse satisfies the contract
```
