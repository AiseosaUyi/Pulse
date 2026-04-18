// Google SERP preview — renders the title / URL breadcrumb / meta
// description the way Google shows them on results pages. Used by
// both the blog list card (mini version) and the side panel (full).
//
// Truncation rules are Google's published limits (not hard caps but
// it's where they start clipping with "..."):
//   - title: 60 chars
//   - meta description: 160 chars
//   - URL breadcrumb: rendered as protocol-stripped path with
//     " › " separators for 2+ path segments.

export interface GooglePreview {
  title_display: string;
  url_display: string;
  meta_display: string;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function buildUrlDisplay(tenantDomain: string, slug: string | null): string {
  const host = tenantDomain.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  if (!slug) return host;
  // Google renders /blog/slug as "host › blog › slug"
  return `${host} › blog › ${slug}`;
}

export interface PreviewInput {
  title: string;
  metaDescription: string | null;
  slug: string | null;
  tenantDomain: string;
}

export function buildGooglePreview(input: PreviewInput): GooglePreview {
  return {
    title_display: truncate(input.title, 60),
    url_display: buildUrlDisplay(input.tenantDomain, input.slug),
    meta_display: truncate(
      input.metaDescription?.trim() || "No meta description set.",
      160
    ),
  };
}
