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
          SEO Command Center
        </h1>
        <p className="text-text-secondary text-sm mt-0.5">
          100x your organic growth with AI-powered SEO
        </p>
      </div>
      <SEOTabNav />
    </>
  );
}
