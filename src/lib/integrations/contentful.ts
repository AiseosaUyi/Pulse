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

const SPACE = process.env.CONTENTFUL_SPACE_ID;
const CMA_TOKEN = process.env.CONTENTFUL_CMA_TOKEN;
const ENV_ID = process.env.CONTENTFUL_ENVIRONMENT ?? "master";
const LOCALE = process.env.CONTENTFUL_DEFAULT_LOCALE ?? "en-US";
const CT_ID = "gruveBlog";

export function isContentfulConfigured(): boolean {
  return Boolean(SPACE && CMA_TOKEN);
}

export class ContentfulNotConfiguredError extends Error {
  constructor() {
    super(
      "Contentful is not configured — set CONTENTFUL_SPACE_ID and CONTENTFUL_CMA_TOKEN."
    );
    this.name = "ContentfulNotConfiguredError";
  }
}

let envPromise: Promise<Environment> | null = null;

function getEnv(): Promise<Environment> {
  if (!isContentfulConfigured()) throw new ContentfulNotConfiguredError();
  if (!envPromise) {
    envPromise = (async () => {
      const client = createClient(
        { accessToken: CMA_TOKEN! },
        { type: "legacy" }
      );
      const space = await client.getSpace(SPACE!);
      return space.getEnvironment(ENV_ID);
    })().catch((e) => {
      envPromise = null; // allow retry on transient auth/network failure
      throw e;
    });
  }
  return envPromise;
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
}

/** Asset ids already uploaded/published by the publish runner. */
export interface GruveBlogAssets {
  bannerImageId?: string | null;
  thumbnailId?: string | null;
  authorImageId?: string | null;
}

function loc<T>(v: T): Record<string, T> {
  return { [LOCALE]: v };
}

/** Pure mapper → Contentful entry `fields` (locale-wrapped). */
export function mapToGruveBlogFields(
  d: GruveBlogDraft,
  assets: GruveBlogAssets
): Record<string, Record<string, unknown>> {
  const fields: Record<string, Record<string, unknown>> = {
    title: loc(d.title),
    slug: loc(d.slug),
    content: loc(d.bodyRichText),
    pulseId: loc(d.pulseId),
  };
  if (d.excerpt != null) fields.description = loc(d.excerpt);
  if (d.author != null) fields.author = loc(d.author);
  if (d.readMinutes != null) fields.minuteRead = loc(d.readMinutes);
  if (d.seoMetaTitle != null) fields.seoTitle = loc(d.seoMetaTitle);
  if (d.seoMetaDescription != null)
    fields.seoDescription = loc(d.seoMetaDescription);
  if (d.canonicalOverride != null)
    fields.canonicalUrl = loc(d.canonicalOverride);
  if (d.faqItems != null) fields.faqItems = loc(d.faqItems);
  if (d.jsonLdOverrides != null) fields.jsonLd = loc(d.jsonLdOverrides);
  if (d.pulseMetadata != null) fields.pulseMetadata = loc(d.pulseMetadata);

  const banner = assetLink(assets.bannerImageId);
  if (banner) fields.bannerImage = loc(banner);
  const thumb = assetLink(assets.thumbnailId);
  if (thumb) fields.thumbnail = loc(thumb);
  const authorImg = assetLink(assets.authorImageId);
  if (authorImg) fields.authorImage = loc(authorImg);

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
  input: UploadAssetInput
): Promise<string> {
  const env = await getEnv();
  let asset = await env.createAsset({
    fields: {
      title: loc(input.title),
      file: loc({
        contentType: input.contentType,
        fileName: input.fileName,
        upload: input.url,
      }),
    },
  });
  asset = await asset.processForAllLocales();

  // Processing is async — poll until the file URL resolves.
  const deadline = Date.now() + 30_000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const fileLoc = (asset.fields.file as Record<string, { url?: string }>)?.[
      LOCALE
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
  pulseId: string
): Promise<string | null> {
  const res = await env.getEntries({
    content_type: CT_ID,
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
  assets: GruveBlogAssets
): Promise<UpsertResult> {
  const env = await getEnv();
  const fields = mapToGruveBlogFields(draft, assets);
  const existingId = await findEntryIdByPulseId(env, draft.pulseId);

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

  const created = await env.createEntry(CT_ID, { fields });
  return {
    entryId: created.sys.id,
    version: created.sys.version,
    created: true,
  };
}

/**
 * Publish the entry. This IS the `notify_gruve` mechanism — Gruve's own
 * Contentful webhook handles revalidation; Pulse never calls
 * /api/revalidate (PULSE-SEO-SPEC.md §12).
 */
export async function publishGruveBlogEntry(
  entryId: string
): Promise<{ entryId: string; version: number }> {
  const env = await getEnv();
  const entry = await env.getEntry(entryId);
  const published = await entry.publish();
  return { entryId: published.sys.id, version: published.sys.version };
}
