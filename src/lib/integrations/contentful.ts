// Contentful integration — pushes approved Pulse drafts into Gruve's
// `gruveBlog` content type (space nc7eiymdfagh). Server-only.
//
// PULSE-SEO-SPEC.md §5 (field map), §6 (idempotency), §12 (publish).
//
// IDEMPOTENCY DEVIATION (deliberate — flagged):
// The brief specifies a CDA GraphQL lookup `gruveBlogCollection(where:
// {pulseId})` as the create-vs-update guard. The CDA only returns
// *published* entries, so a draft that was created but not yet published
// (or later unpublished) would be invisible and we'd create a duplicate
// on the next run — defeating idempotency for exactly the states the
// publish workflow passes through. We instead query the Management API
// (`getEntries({'fields.pulseId': id})`), which sees drafts too, making
// it the correct guard. The CMA `unique:true` validation on pulseId
// (set by scripts/migrate-contentful-model.ts) remains the backstop.
//
// Legacy chainable client: ergonomic and consistent with the Appendix C
// script. Deprecated in contentful-management; remove path is the plain
// client when we move to v13.

import "server-only";
import { createClient, type Environment } from "contentful-management";
import { getIntegrationSecrets } from "@/lib/services/integrations";

// Pulse is multi-tenant. Contentful credentials resolve PER TENANT from the
// `contentful` integration (tenant_integrations), falling back to the global
// env vars so Gruve keeps working unchanged while Sippy/others connect their
// own space. Content-type ids + locale are part of the per-tenant config.
const ENV_SPACE = process.env.CONTENTFUL_SPACE_ID;
const ENV_CMA_TOKEN = process.env.CONTENTFUL_CMA_TOKEN;
const ENV_ENV_ID = process.env.CONTENTFUL_ENVIRONMENT ?? "master";
// Test/staging Contentful environment (e.g. Gruve's `Production` env, which the
// gamma site reads). Used when publishing with target 'test' so a single Pulse
// deployment can publish to either environment without redeploying.
const ENV_TEST_ENV_ID = process.env.CONTENTFUL_TEST_ENVIRONMENT ?? "Production";
const ENV_LOCALE = process.env.CONTENTFUL_DEFAULT_LOCALE ?? "en-US";
const DEFAULT_BLOG_CT = "gruveBlog";
const DEFAULT_LANDING_CT = "seoLandingPage";

/**
 * Which environment a publish targets:
 * - "live" → the production Contentful environment (master → www)
 * - "test" → the staging Contentful environment (Production → gamma)
 */
export type PublishTarget = "live" | "test";

export interface ContentfulConfig {
  spaceId: string;
  cmaToken: string;
  envId: string;
  locale: string;
  blogContentType: string;
  landingContentType: string;
  /**
   * Per-tenant field ID overrides. Keys are Pulse's canonical field names
   * (matching gruveBlog defaults). Values are the actual field IDs in this
   * tenant's content type, or null to skip that field entirely.
   *
   * Example for sippyBlog:
   *   { title: "blogTitle", content: "blogContent", minuteRead: "readTime", question: null }
   */
  fieldAliases?: Record<string, string | null>;
}

function envContentfulConfig(target: PublishTarget): ContentfulConfig | null {
  if (!ENV_SPACE || !ENV_CMA_TOKEN) return null;
  return {
    spaceId: ENV_SPACE,
    cmaToken: ENV_CMA_TOKEN,
    envId: target === "test" ? ENV_TEST_ENV_ID : ENV_ENV_ID,
    locale: ENV_LOCALE,
    blogContentType: DEFAULT_BLOG_CT,
    landingContentType: DEFAULT_LANDING_CT,
  };
}

/**
 * Resolve a tenant's Contentful config: per-tenant integration first
 * (provider 'contentful'), env vars as fallback. Returns null when neither
 * is configured.
 *
 * `target` selects the environment: "live" → production env (master), "test" →
 * staging env (Production). The CMA token and space are the same for both — only
 * the environment id changes — so one set of credentials drives both targets.
 */
export async function resolveContentfulConfig(
  tenantSlug: string,
  target: PublishTarget = "live"
): Promise<ContentfulConfig | null> {
  const creds = await getIntegrationSecrets(tenantSlug, "contentful");
  const spaceId = creds?.config?.space_id ? String(creds.config.space_id) : "";
  if (creds?.secretToken && spaceId) {
    const liveEnv = String(creds.config.environment ?? "master");
    const testEnv = String(creds.config.test_environment ?? "Production");
    const rawAliases = creds.config.field_aliases;
    const fieldAliases: Record<string, string | null> | undefined =
      rawAliases && typeof rawAliases === "object" && !Array.isArray(rawAliases)
        ? (rawAliases as Record<string, string | null>)
        : undefined;
    return {
      spaceId,
      cmaToken: creds.secretToken,
      envId: target === "test" ? testEnv : liveEnv,
      locale: String(creds.config.locale ?? "en-US"),
      blogContentType: String(creds.config.blog_content_type ?? DEFAULT_BLOG_CT),
      landingContentType: String(
        creds.config.landing_content_type ?? DEFAULT_LANDING_CT
      ),
      fieldAliases,
    };
  }
  return envContentfulConfig(target);
}

/** True if Contentful is usable for this tenant (per-tenant or env fallback). */
export async function isContentfulConfigured(
  tenantSlug: string
): Promise<boolean> {
  return (await resolveContentfulConfig(tenantSlug)) !== null;
}

/** Validate raw Contentful credentials by fetching the space. */
export async function testContentfulConnection(opts: {
  spaceId: string;
  cmaToken: string;
  envId?: string;
}): Promise<{ ok: boolean; detail?: string; error?: string }> {
  try {
    const client = createClient(
      { accessToken: opts.cmaToken },
      { type: "legacy" }
    );
    const space = await client.getSpace(opts.spaceId);
    const env = await space.getEnvironment(opts.envId ?? "master");
    return { ok: true, detail: `Connected to "${space.name}" (${env.sys.id})` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

export class ContentfulNotConfiguredError extends Error {
  constructor() {
    super(
      "Contentful is not configured — connect a Contentful integration for this workspace or set CONTENTFUL_SPACE_ID + CONTENTFUL_CMA_TOKEN."
    );
    this.name = "ContentfulNotConfiguredError";
  }
}

// One cached Environment per (space:env) so multiple tenants don't share a
// client. Keyed by space+env; the token is captured in the client closure.
const envCache = new Map<string, Promise<Environment>>();

function getEnv(cfg: ContentfulConfig): Promise<Environment> {
  const key = `${cfg.spaceId}:${cfg.envId}`;
  let p = envCache.get(key);
  if (!p) {
    p = (async () => {
      const client = createClient(
        { accessToken: cfg.cmaToken },
        { type: "legacy" }
      );
      const space = await client.getSpace(cfg.spaceId);
      return space.getEnvironment(cfg.envId);
    })().catch((e) => {
      envCache.delete(key); // allow retry on transient auth/network failure
      throw e;
    });
    envCache.set(key, p);
  }
  return p;
}

// ── Field map (PULSE-SEO-SPEC.md §5) ──────────────────────────────────

type AssetLink = { sys: { type: "Link"; linkType: "Asset"; id: string } };

function assetLink(id: string | null | undefined): AssetLink | undefined {
  return id ? { sys: { type: "Link", linkType: "Asset", id } } : undefined;
}

/** The subset of blog_posts the gruveBlog map needs. */
export interface GruveBlogDraft {
  pulseId: string; // = blog_posts.id
  title: string;
  slug: string;
  /** gruveBlog sub-heading / FAQ-style hook (REQUIRED on the content type).
   *  Optional here — the mapper derives a fallback when not supplied. */
  question?: string | null;
  excerpt: string | null;
  /** Contentful RichText document (already in RichText shape upstream). */
  bodyRichText: unknown;
  author: string | null;
  readMinutes: number | null;
  seoMetaTitle: string | null;
  seoMetaDescription: string | null;
  canonicalOverride: string | null;
  faqItems: unknown; // Object
  jsonLdOverrides: unknown; // Object
  pulseMetadata: unknown; // Object (hidden)
  // SEO / E-E-A-T expansion (slice 2).
  tags?: string[] | null;
  category?: string | null;
  authorBio?: string | null;
  authorTitle?: string | null;
  authorUrl?: string | null;
  publishedDate?: string | null; // ISO date
  updatedDate?: string | null; // ISO date
  noindex?: boolean | null;
}

/** Asset ids already uploaded/published by the publish runner. */
export interface GruveBlogAssets {
  bannerImageId?: string | null;
  thumbnailId?: string | null;
  authorImageId?: string | null;
}

function loc<T>(locale: string, v: T): Record<string, T> {
  return { [locale]: v };
}

/**
 * Resolve a canonical field ID through the tenant's fieldAliases map.
 * Returns the aliased name, or the canonical name if no alias is defined.
 * Returns null when the field is explicitly aliased to null (skip it).
 */
function resolveField(
  canonical: string,
  aliases?: Record<string, string | null>
): string | null {
  if (!aliases || !(canonical in aliases)) return canonical;
  return aliases[canonical]; // may be null (skip) or a new name
}

/** Set a field using the alias map. No-op when the field is aliased to null. */
function setField(
  fields: Record<string, Record<string, unknown>>,
  canonical: string,
  value: Record<string, unknown>,
  aliases?: Record<string, string | null>
): void {
  const key = resolveField(canonical, aliases);
  if (key !== null) fields[key] = value;
}

/** Pure mapper → Contentful entry `fields` (locale-wrapped). */
export function mapToGruveBlogFields(
  d: GruveBlogDraft,
  assets: GruveBlogAssets,
  cfg: ContentfulConfig
): Record<string, Record<string, unknown>> {
  const L = <T>(v: T) => loc(cfg.locale, v);
  const a = cfg.fieldAliases;
  const fields: Record<string, Record<string, unknown>> = {};

  setField(fields, "title", L(d.title), a);
  setField(fields, "slug", L(d.slug), a);
  setField(fields, "content", L(d.bodyRichText), a);
  setField(fields, "pulseId", L(d.pulseId), a);

  // `question` is REQUIRED on gruveBlog (verified required=true on the live
  // model). Always emit it unless aliased to null (e.g. sippyBlog has no
  // question field). Falls back: first FAQ → excerpt → title.
  const firstFaq =
    Array.isArray(d.faqItems) && d.faqItems[0] && typeof d.faqItems[0] === "object"
      ? (d.faqItems[0] as { question?: string }).question
      : undefined;
  setField(fields, "question", L(d.question ?? firstFaq ?? d.excerpt ?? d.title), a);

  if (d.excerpt != null) setField(fields, "description", L(d.excerpt), a);
  if (d.author != null) setField(fields, "author", L(d.author), a);
  if (d.readMinutes != null) setField(fields, "minuteRead", L(d.readMinutes), a);
  if (d.seoMetaTitle != null) setField(fields, "seoTitle", L(d.seoMetaTitle), a);
  if (d.seoMetaDescription != null) setField(fields, "seoDescription", L(d.seoMetaDescription), a);
  if (d.canonicalOverride != null) setField(fields, "canonicalUrl", L(d.canonicalOverride), a);
  if (d.faqItems != null) setField(fields, "faqItems", L(d.faqItems), a);
  if (d.jsonLdOverrides != null) setField(fields, "jsonLd", L(d.jsonLdOverrides), a);
  if (d.pulseMetadata != null) setField(fields, "pulseMetadata", L(d.pulseMetadata), a);
  // SEO / E-E-A-T expansion (slice 2).
  if (d.tags != null && d.tags.length > 0) setField(fields, "tags", L(d.tags), a);
  if (d.category != null) setField(fields, "category", L(d.category), a);
  if (d.authorBio != null) setField(fields, "authorBio", L(d.authorBio), a);
  if (d.authorTitle != null) setField(fields, "authorTitle", L(d.authorTitle), a);
  if (d.authorUrl != null) setField(fields, "authorUrl", L(d.authorUrl), a);
  if (d.publishedDate != null) setField(fields, "publishedDate", L(d.publishedDate), a);
  if (d.updatedDate != null) setField(fields, "updatedDate", L(d.updatedDate), a);
  if (d.noindex != null) setField(fields, "noindex", L(d.noindex), a);

  const banner = assetLink(assets.bannerImageId);
  if (banner) setField(fields, "bannerImage", L(banner), a);
  const thumb = assetLink(assets.thumbnailId);
  if (thumb) setField(fields, "thumbnail", L(thumb), a);
  const authorImg = assetLink(assets.authorImageId);
  if (authorImg) setField(fields, "authorImage", L(authorImg), a);

  return fields;
}

// ── Assets ────────────────────────────────────────────────────────────

export interface UploadAssetInput {
  /** Remote URL Contentful fetches (no bytes through this function). */
  url: string;
  fileName: string;
  contentType: string;
  title: string;
}

/**
 * Create → process → wait → publish an asset from a URL. Idempotency is
 * the caller's concern (publish runner checkpoints the asset id).
 */
export async function uploadGruveAsset(
  input: UploadAssetInput,
  cfg: ContentfulConfig
): Promise<string> {
  const env = await getEnv(cfg);
  const L = <T>(v: T) => loc(cfg.locale, v);
  let asset = await env.createAsset({
    fields: {
      title: L(input.title),
      file: L({
        contentType: input.contentType,
        fileName: input.fileName,
        upload: input.url,
      }),
    },
  });
  asset = await asset.processForAllLocales();

  // Processing is async — poll until the file URL resolves.
  const deadline = Date.now() + 30_000;
  while (true) {
    const fileLoc = (asset.fields.file as Record<string, { url?: string }>)?.[
      cfg.locale
    ];
    if (fileLoc?.url) break;
    if (Date.now() > deadline) {
      throw new Error(`Asset ${asset.sys.id} processing timed out`);
    }
    await new Promise((r) => setTimeout(r, 1000));
    asset = await env.getAsset(asset.sys.id);
  }

  const published = await asset.publish();
  return published.sys.id;
}

// ── Idempotent entry upsert (PULSE-SEO-SPEC.md §6) ────────────────────

export interface UpsertResult {
  entryId: string;
  version: number;
  created: boolean;
}

/** CMA guard — sees drafts (see deviation note at top). */
async function findEntryIdByPulseId(
  env: Environment,
  contentType: string,
  pulseId: string
): Promise<string | null> {
  const res = await env.getEntries({
    content_type: contentType,
    "fields.pulseId": pulseId,
    limit: 1,
  });
  return res.items[0]?.sys.id ?? null;
}

/**
 * Upsert the gruveBlog entry keyed by pulseId. Does NOT publish — that
 * is the `publish_entry`/`notify_gruve` step (see publishGruveBlogEntry).
 */
export async function upsertGruveBlog(
  draft: GruveBlogDraft,
  assets: GruveBlogAssets,
  cfg: ContentfulConfig
): Promise<UpsertResult> {
  const env = await getEnv(cfg);
  const fields = mapToGruveBlogFields(draft, assets, cfg);
  const existingId = await findEntryIdByPulseId(
    env,
    cfg.blogContentType,
    draft.pulseId
  );

  if (existingId) {
    const entry = await env.getEntry(existingId);
    entry.fields = { ...entry.fields, ...fields };
    const updated = await entry.update();
    return {
      entryId: updated.sys.id,
      version: updated.sys.version,
      created: false,
    };
  }

  const created = await env.createEntry(cfg.blogContentType, { fields });
  return {
    entryId: created.sys.id,
    version: created.sys.version,
    created: true,
  };
}

/**
 * Publish the entry. This IS the `notify_gruve` mechanism — the tenant's own
 * Contentful webhook handles revalidation; Pulse never calls
 * /api/revalidate (PULSE-SEO-SPEC.md §12).
 */
export async function publishGruveBlogEntry(
  entryId: string,
  cfg: ContentfulConfig
): Promise<{ entryId: string; version: number }> {
  const env = await getEnv(cfg);
  const entry = await env.getEntry(entryId);
  const published = await entry.publish();
  return { entryId: published.sys.id, version: published.sys.version };
}

// ── Programmatic SEO landing pages (seoLandingPage, W5) ────────────────
// Same idempotent upsert-by-pulseId pattern as the blog type, against the
// tenant's landing content type (default `seoLandingPage`) which the tenant's
// frontend renders at /discover/<slug>. The content type must be provisioned
// in the tenant's Contentful space first (Appendix-C-style CMA migration).

export interface SeoLandingDraft {
  pulseId: string; // = programmatic_pages.id
  title: string;
  slug: string;
  description: string | null; // meta/intro summary
  bodyRichText: unknown; // Contentful RichText document
  category: string | null; // drives the live event grid
  location: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalOverride: string | null;
  faqItems?: unknown;
  jsonLdOverrides?: unknown;
  noindex?: boolean | null;
}

export function mapToSeoLandingFields(
  d: SeoLandingDraft,
  cfg: ContentfulConfig
): Record<string, Record<string, unknown>> {
  const L = <T>(v: T) => loc(cfg.locale, v);
  const fields: Record<string, Record<string, unknown>> = {
    title: L(d.title),
    slug: L(d.slug),
    content: L(d.bodyRichText),
    pulseId: L(d.pulseId),
  };
  if (d.description != null) fields.description = L(d.description);
  if (d.category != null) fields.category = L(d.category);
  if (d.location != null) fields.location = L(d.location);
  if (d.seoTitle != null) fields.seoTitle = L(d.seoTitle);
  if (d.seoDescription != null) fields.seoDescription = L(d.seoDescription);
  if (d.canonicalOverride != null) fields.canonicalUrl = L(d.canonicalOverride);
  if (d.faqItems != null) fields.faqItems = L(d.faqItems);
  if (d.jsonLdOverrides != null) fields.jsonLd = L(d.jsonLdOverrides);
  if (d.noindex != null) fields.noindex = L(d.noindex);
  return fields;
}

export async function upsertSeoLandingPage(
  draft: SeoLandingDraft,
  cfg: ContentfulConfig
): Promise<UpsertResult> {
  const env = await getEnv(cfg);
  const fields = mapToSeoLandingFields(draft, cfg);
  const existingId = await findEntryIdByPulseId(
    env,
    cfg.landingContentType,
    draft.pulseId
  );

  if (existingId) {
    const entry = await env.getEntry(existingId);
    entry.fields = { ...entry.fields, ...fields };
    const updated = await entry.update();
    return { entryId: updated.sys.id, version: updated.sys.version, created: false };
  }

  const created = await env.createEntry(cfg.landingContentType, { fields });
  return { entryId: created.sys.id, version: created.sys.version, created: true };
}

export async function publishSeoLandingEntry(
  entryId: string,
  cfg: ContentfulConfig
): Promise<{ entryId: string; version: number }> {
  const env = await getEnv(cfg);
  const entry = await env.getEntry(entryId);
  const published = await entry.publish();
  return { entryId: published.sys.id, version: published.sys.version };
}
