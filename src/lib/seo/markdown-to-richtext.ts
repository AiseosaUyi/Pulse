import "server-only";
import { richTextFromMarkdown } from "@contentful/rich-text-from-markdown";
import type { Document } from "@contentful/rich-text-types";

// Converts the blog body (GitHub-flavored Markdown stored in blog_posts.content)
// into a Contentful RichText `Document` for the gruveBlog `content` field. This
// is the conversion the publish-runner flagged as "not wired (spec §5/§8)".
//
// Inline images are stripped here — embedded assets are handled separately by
// the publish-runner's upload_inline_assets step (and would otherwise need an
// async asset-creator callback that produces valid embedded-asset-block nodes).
export async function markdownToRichText(markdown: string): Promise<Document> {
  const cleaned = (markdown ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // drop ![alt](url) images
    .trim();
  const doc = await richTextFromMarkdown(cleaned || "​");
  return doc;
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
