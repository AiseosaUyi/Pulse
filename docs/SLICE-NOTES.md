# Pulse ↔ Gruve SEO blog + keyword work — change log & go-live checklist

One doc for you + the Gruve CTO. Covers four shipped slices. Both repos
typecheck clean (Gruve 0 errors; Pulse only 4 pre-existing `group-patterns`
test errors, none in changed files). Pulse contract verifier (`pnpm
verify:gruve`) is green.

---

## What shipped

1. **Publishing actually works.** The publish-runner needed `body_rich_text`
   but nothing produced it. Wired markdown → Contentful RichText. Added image
   uploads (banner/thumbnail/author avatar) + author/question, and a gated
   **"Push to Gruve"** button. One publish lands on **both** gamma + www
   (they read the same Contentful `master`).
2. **SEO fields, both sides.** 8 new `gruveBlog` fields (tags, category,
   authorBio, authorTitle, authorUrl, publishedDate, updatedDate, noindex) +
   the earlier 7 (seoTitle, seoDescription, canonicalUrl, faqItems, jsonLd,
   pulseId, pulseMetadata). Pulse editor + plumbing populate them; Gruve render
   **emits** them (seoTitle/canonical/keywords/noindex, E‑E‑A‑T author Person
   schema, explicit dates, articleSection, JSON-LD overrides, FAQPage).
3. **Keyword → Gruve deep-links.** AI maps a keyword to the **closest** Gruve
   category + location + time tab ("top raves in Lagos" →
   `/categories/music?location=Lagos`; "weekend events near me" →
   `/home?when=weekend`). Keywords tab has per-row + bulk "Generate Gruve
   links". Gruve `/home` and `/categories/[name]` read the params.
4. **Auto-fill.** Generating a blog pre-fills slug, excerpt, tags, FAQ,
   question, category, and **author + avatar from the signed-in profile**.

---

## Files changed — Pulse (this repo)

**New**
- `supabase/migrations/050_blog_publish_fields.sql` — `question` col + `blog-assets` bucket
- `supabase/migrations/051_blog_seo_fields.sql` — 8 SEO columns
- `src/lib/seo/markdown-to-richtext.ts` — markdown → Contentful RichText
- `src/lib/seo/gruve-discovery.ts` — keyword→filter vocab + URL builder + heuristic
- `src/lib/ai/keyword-to-gruve.ts` — AI closest-category mapper
- `src/lib/actions/publish-to-gruve.ts` — gated "Push to Gruve"
- `src/lib/actions/keyword-deeplink.ts` — generate / bulk-backfill deep-links
- `src/components/seo/blog/ImageUploadField.tsx` — uploader → public bucket URL
- `src/components/keywords/BackfillDeeplinksButton.tsx` — bulk keyword button
- `scripts/verify-gruve-contract.ts` — contract verifier (`pnpm verify:gruve`)
- `scripts/check-contentful-model.ts` — read-only readiness check (`pnpm check:contentful`)
- `scripts/publish-smoke.ts` — one-shot publish test (`pnpm smoke:publish`)
- `scripts/smoke-cleanup.ts` — remove QA post (`pnpm smoke:cleanup`)
- `docs/GRUVE-CUTOVER-HANDOFF.md`, `docs/SLICE-NOTES.md`

**Modified**
- `next.config.ts` — `/.well-known/jwks.json` rewrite (dev+prod)
- `package.json` — verify/smoke/check scripts; `@contentful/rich-text-from-markdown` + `-types`
- `scripts/migrate-contentful-model.ts` — adds the 8 SEO fields (idempotent)
- `src/lib/integrations/contentful.ts` — `GruveBlogDraft` + mapper: question + 8 SEO fields
- `src/lib/seo/gruve-client.ts` — `jti` on the C5 service JWT
- `src/lib/seo/publish-runner.ts` — select + draft builder for new fields
- `src/lib/actions/seo-contentful-sync.ts` — RichText fallback + new fields
- `src/lib/actions/seo-blog.ts` — auto-populate + author defaults from profile
- `src/lib/actions/blog-posts.ts` — `updateBlogPost` accepts new fields
- `src/lib/services/blog-posts.ts`, `src/lib/types/blog-posts.ts` — read/typing
- `src/app/(app)/(intelligence)/seo-tracker/blog-writer/[id]/{page,client}.tsx` — editor UI + profile defaults
- `src/app/(app)/(intelligence)/seo-tracker/keywords/page.tsx`, `src/components/keywords/KeywordRow.tsx` — keyword deep-link UI

> Not mine (pre-existing working-tree changes): `src/lib/actions/drive-import.ts`, `src/lib/integrations/brevo.ts`.

## Files changed — Gruve (`/Frontend`) → **one PR for the CTO**
- `lib/contentful/queries.ts` — select the SEO fields in BLOG_BY_SLUG/PREVIEW
- `lib/contentful/blog.ts` — adapter maps them (cast; see codegen note)
- `interface/blogTypes.ts` — `Fields` gains the optional SEO fields
- `app/blogs/[slug]/page.tsx` — generateMetadata + JSON-LD emit them
- `app/(dashboard)/home/page.tsx`, `components/home/Home.tsx` — read `?when` & `?location`
- `app/(dashboard)/categories/[name]/page.tsx`, `components/categories/CategoryDetails/CategoryDetails.tsx` — read `?location` + SEO metadata

**CTO note:** after merging, run `bun run codegen` (regenerates Contentful types
against the new model) so the `(item as Record<string, unknown>)` casts in
`blog.ts` can be tightened. Not required to build — `typescript.ignoreBuildErrors`
is on and it typechecks clean as-is.

---

## Go-live checklist (in order)

- [ ] **Pulse:** apply migrations `050` + `051` (Supabase SQL editor or `supabase db push`).
- [ ] **Pulse:** `pnpm check:contentful` → expect "READY: migration applied" (Contentful model already migrated).
- [ ] **Pulse:** ensure Vercel env has `CONTENTFUL_CMA_TOKEN`, `CONTENTFUL_SPACE_ID=nc7eiymdfagh`, `CONTENTFUL_ENVIRONMENT=master`, `CONTENTFUL_DEFAULT_LOCALE=en-US` (server-only). Deploy.
- [ ] **Gruve (CTO):** review + merge the Gruve PR; `bun run codegen`; deploy to `dev` (gamma) then `main` (www).
- [ ] **Gruve (CTO):** investigate the **prod blog 500** — every `/blogs/*` 500s in prod while rendering fine locally (PPR/deploy issue, unrelated to this work). Blocks live blog rendering until fixed.
- [ ] **Verify:** generate a blog in Pulse → upload banner+thumbnail (author auto-filled) → Push to Gruve → open the live + gamma links.
- [ ] **Keywords:** open the Keywords tab → "Generate Gruve links" → confirm the deep-links.
- [ ] **Cleanup:** `pnpm smoke:cleanup` to unpublish the `qa-pulse-e2e-2026-05` test post.

## Handy commands (Pulse)
```
pnpm verify:gruve       # wire-contract verifier (crypto + field contract)
pnpm check:contentful   # read-only: token valid + migration status
pnpm smoke:publish      # publish a QA post end-to-end
pnpm smoke:cleanup      # remove the QA post
```
