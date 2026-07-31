import { describe, it, expect, vi } from "vitest";

// Regression test for: publishBlogToGruve used to reuse a cached
// blog_posts.body_rich_text once it was ever set, silently ignoring any
// edits made to `content` afterward (e.g. a link added post-first-publish).
// See src/lib/actions/publish-to-gruve.ts.

const OLD_BODY_RICH_TEXT = {
  nodeType: "document",
  data: {},
  content: [{ nodeType: "paragraph", data: {}, content: [] }],
};
const NEW_BODY_RICH_TEXT = {
  nodeType: "document",
  data: {},
  content: [{ nodeType: "heading-1", data: {}, content: [] }],
};

const postRow = {
  tenant_slug: "gruve",
  title: "Test post",
  slug: "test-post",
  content: "# New content with a [link](https://gruve.events)",
  // Contentful's gruveBlog.question field enforces 12-30 chars (see
  // QUESTION_MIN/QUESTION_MAX in publish-to-gruve.ts) — must satisfy that
  // here or the length check short-circuits before markdownToRichText is
  // ever called, which is what this regression test is actually about.
  question: "Why does this matter?",
  author: "Author",
  author_image: "http://img",
  cover_image: { url: "http://cover" },
  thumbnail: { url: "http://thumb" },
  // Already populated from a prior publish — this stale value must never
  // win over a fresh conversion of the current `content`.
  body_rich_text: OLD_BODY_RICH_TEXT,
};

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
  getCurrentTenant: vi.fn().mockResolvedValue({ slug: "gruve" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: postRow, error: null }),
        }),
      }),
    }),
  }),
}));

const adminUpdateMock = vi
  .fn()
  .mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn().mockReturnValue({
    from: () => ({ update: adminUpdateMock }),
  }),
}));

vi.mock("@/lib/seo/publish-runner", () => ({
  runPublish: vi.fn().mockResolvedValue({ status: "succeeded" }),
}));

vi.mock("@/lib/seo/markdown-to-richtext", () => ({
  markdownToRichText: vi.fn().mockResolvedValue(NEW_BODY_RICH_TEXT),
  isRichTextDocument: (v: unknown) => typeof v === "object" && v !== null,
}));

vi.mock("@/lib/integrations/contentful", () => ({
  resolveContentfulConfig: vi
    .fn()
    .mockResolvedValue({ envId: "test-env", locale: "en-US" }),
}));

vi.mock("@/lib/seo/tenant-seo-config", () => ({
  getTenantSeoConfig: vi.fn().mockResolvedValue({
    blogPathPrefix: "/blog",
    siteBaseUrl: "https://gruve.events",
    stagingBaseUrl: "https://staging.gruve.events",
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { publishBlogToGruve } = await import("@/lib/actions/publish-to-gruve");
const { markdownToRichText } = await import("@/lib/seo/markdown-to-richtext");

describe("publishBlogToGruve — stale body_rich_text regression", () => {
  it("always regenerates RichText from the current content, even when body_rich_text is already a valid document", async () => {
    const result = await publishBlogToGruve("post-1", "test");

    expect(result.success).toBe(true);
    expect(markdownToRichText).toHaveBeenCalledWith(
      postRow.content,
      expect.any(Object),
      postRow.title
    );

    expect(adminUpdateMock).toHaveBeenCalledTimes(1);
    const staged = adminUpdateMock.mock.calls[0][0];
    expect(staged.body_rich_text).toBe(NEW_BODY_RICH_TEXT);
    expect(staged.body_rich_text).not.toBe(OLD_BODY_RICH_TEXT);
  });
});
