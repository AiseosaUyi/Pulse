// Pure, client-safe helper for deriving a blog post's public staging/live
// URLs from its slug + tenant SEO config. Deliberately has ZERO imports
// (no "server-only" modules, no Supabase) so it can be pulled into
// "use client" components (the blog editor, the post-list side panel)
// without dragging their whole server-only module graph along —
// `src/lib/seo/tenant-seo-config.ts` imports `next/headers` transitively
// via `getTenant`, which breaks the client bundle if a client component
// imports anything else from that file.
//
// Mirrors the `${blogPathPrefix}/${slug}` shape `publishBlogToGruve` builds
// at publish time (src/lib/actions/publish-to-gruve.ts). Computed rather
// than read back from a one-time publish response, so the editor (and post
// list) can always show a durable link for any post that has ever been
// published — not just right after the publish action fires.

export interface BlogUrlSeoConfig {
  /** Public site base URL, e.g. https://www.gruve.events. Null if unset. */
  siteBaseUrl: string | null;
  /** Staging/preview site base URL, e.g. https://gamma.gruve.events. */
  stagingBaseUrl: string | null;
  /** Route prefix the tenant's blog uses, e.g. "/blogs". */
  blogPathPrefix: string;
}

export interface BlogPublicUrls {
  /** Production URL, null if the tenant has no site domain configured. */
  liveUrl: string | null;
  /** Staging/preview URL. Falls back to liveUrl when no distinct staging
   *  domain is configured; null if neither is set. */
  stagingUrl: string | null;
}

export function buildBlogUrls(
  slug: string | null,
  seo: BlogUrlSeoConfig
): BlogPublicUrls {
  if (!slug) return { liveUrl: null, stagingUrl: null };
  const path = `${seo.blogPathPrefix}/${slug}`;
  const liveUrl = seo.siteBaseUrl ? `${seo.siteBaseUrl}${path}` : null;
  const stagingUrl = seo.stagingBaseUrl ? `${seo.stagingBaseUrl}${path}` : liveUrl;
  return { liveUrl, stagingUrl };
}
