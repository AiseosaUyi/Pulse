"use client";

// Thin client wrapper so the SEO section's title + tab nav can be
// hidden on focused sub-pages (e.g. the full-page blog editor) while
// the surrounding server-rendered layout stays lean.

import { usePathname } from "next/navigation";
import { SEOTabNav } from "@/components/seo/SEOTabNav";

export function SEOPageHeader() {
  const pathname = usePathname();
  // Hide on the full-page blog editor: /seo-tracker/blog-writer/[id]
  const isFullPageEditor =
    /^\/seo-tracker\/blog-writer\/[^/]+$/.test(pathname);
  if (isFullPageEditor) return null;

  return (
    <>
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-foreground">
          SEO and blog
        </h1>
        <p className="text-text-secondary text-sm mt-0.5">
          Keywords, topics and blog posts that bring people in from search.
        </p>
      </div>
      <SEOTabNav />
    </>
  );
}
