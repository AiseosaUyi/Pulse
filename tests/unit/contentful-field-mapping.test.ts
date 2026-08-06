import { describe, it, expect } from "vitest";
import {
  mapToGruveBlogFields,
  type GruveBlogDraft,
  type ContentfulConfig,
} from "@/lib/integrations/contentful";

describe("Contentful Field Mapping & Type Coercion", () => {
  const baseDraft: GruveBlogDraft = {
    pulseId: "post-123",
    title: "Test Article Title",
    slug: "test-article-title",
    question: "Is this a test question?",
    excerpt: "Short test excerpt",
    bodyRichText: { nodeType: "document", data: {}, content: [] },
    author: "Test Author",
    readMinutes: 5,
    seoMetaTitle: null,
    seoMetaDescription: null,
    canonicalOverride: null,
    faqItems: null,
    jsonLdOverrides: null,
    pulseMetadata: null,
  };

  const defaultAssets = {
    bannerImageId: null,
    thumbnailId: null,
    authorImageId: null,
  };

  it("maps minuteRead as an Integer for standard gruveBlog configuration", () => {
    const config: ContentfulConfig = {
      spaceId: "space-1",
      cmaToken: "token-1",
      envId: "master",
      locale: "en-US",
      blogContentType: "gruveBlog",
      landingContentType: "seoLandingPage",
    };

    const fields = mapToGruveBlogFields(baseDraft, defaultAssets, config);
    expect(fields.minuteRead).toEqual({ "en-US": 5 });
  });

  it("maps minuteRead to readTime as a String (Symbol) when aliased for sippyBlog", () => {
    const config: ContentfulConfig = {
      spaceId: "space-2",
      cmaToken: "token-2",
      envId: "master",
      locale: "en-US",
      blogContentType: "sippyBlog",
      landingContentType: "seoLandingPage",
      fieldAliases: {
        title: "blogTitle",
        content: "blogContent",
        minuteRead: "readTime",
        question: null,
      },
    };

    const fields = mapToGruveBlogFields(baseDraft, defaultAssets, config);
    expect(fields.minuteRead).toBeUndefined(); // canonical key replaced
    expect(fields.readTime).toEqual({ "en-US": "5" }); // aliased key converted to string Symbol
  });
});
