import "server-only";
import { richTextFromMarkdown } from "@contentful/rich-text-from-markdown";
import { BLOCKS, type Document, type Node } from "@contentful/rich-text-types";
import { uploadGruveAsset, type ContentfulConfig } from "@/lib/integrations/contentful";

// Converts the blog body (GitHub-flavored Markdown stored in blog_posts.content)
// into a Contentful RichText `Document` for the gruveBlog `content` field. This
// is the conversion the publish-runner flagged as "not wired (spec §5/§8)".
//
// Inline images (`![alt](url)`) are uploaded as Contentful Assets and spliced
// back in as `embedded-asset-block` nodes when `cfg` is supplied. Pass the
// same `ContentfulConfig` the caller resolved for its publish target — assets
// live in one Contentful *environment*, so a "test" vs "live" publish each
// (re-)upload into their own environment via `cfg.envId`, matching how the
// cover/thumbnail images already behave in the publish runner. Callers that
// haven't resolved a target (e.g. a text-only preview sync) can omit `cfg`;
// images are then dropped, same as the old strip-only behavior.
export async function markdownToRichText(
  markdown: string,
  cfg?: ContentfulConfig,
  titlePrefix = "Inline image"
): Promise<Document> {
  const cleaned = (markdown ?? "").trim();
  let index = 0;
  const doc = await richTextFromMarkdown(cleaned || "​", async (node) => {
    const img = node as unknown as { type?: string; url?: string; alt?: string | null; title?: string | null };
    if (img.type !== "image" || !img.url || !cfg) return null;
    const i = index++;
    const assetId = await uploadGruveAsset(
      {
        url: img.url,
        fileName: fileNameFromUrl(img.url, `${titlePrefix}-${i}`),
        contentType: guessImageContentType(img.url),
        title: img.title?.trim() || img.alt?.trim() || `${titlePrefix} ${i + 1}`,
      },
      cfg
    );
    const assetLink: Node = {
      nodeType: BLOCKS.EMBEDDED_ASSET,
      data: { target: { sys: { type: "Link", linkType: "Asset", id: assetId } } },
      content: [],
    } as Node;
    return assetLink;
  });
  return doc;
}

function guessImageContentType(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    default:
      return "image/jpeg";
  }
}

function fileNameFromUrl(url: string, fallback: string): string {
  try {
    const base = new URL(url).pathname.split("/").pop();
    return base && base.includes(".") ? base : fallback;
  } catch {
    return fallback;
  }
}

// Guard: a valid RichText document has nodeType 'document' and a content array.
export function isRichTextDocument(v: unknown): v is Document {
  return (
    !!v &&
    typeof v === "object" &&
    (v as { nodeType?: string }).nodeType === "document" &&
    Array.isArray((v as { content?: unknown }).content)
  );
}
