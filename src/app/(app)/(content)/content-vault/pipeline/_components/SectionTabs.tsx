"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { ContentSection } from "@/lib/types/content-pipeline";

// One-liner that tells the user what each section is for. Keyed by
// the default slugs we seed on Drive connect; custom sections fall
// back to no hint.
const SECTION_HINT: Record<string, string> = {
  posts:
    "Pieces your team has worked on and queued to post. Track each one through draft → ready → scheduled → posted.",
  // Legacy slugs from earlier dogfood — kept so existing tenants
  // don't see a blank tab.
  social_content:
    "Finished, ready-to-post pieces.",
  video_extracts:
    "Raw clips harvested from longer recordings.",
};

export function SectionTabs({
  sections,
  activeSlug,
}: {
  sections: ContentSection[];
  activeSlug: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const select = (slug: string) => {
    const next = new URLSearchParams(params?.toString());
    next.set("section", slug);
    next.delete("cursor");
    startTransition(() => {
      router.push(`?${next.toString()}`);
    });
  };

  const showTabs = sections.length > 1;
  if (!showTabs) return null;

  return (
    <div className="inline-flex rounded-xl bg-gray-100 dark:bg-gray-900 p-1">
      {sections.map((s) => {
        const active = s.slug === activeSlug;
        return (
          <button
            key={s.slug}
            type="button"
            onClick={() => select(s.slug)}
            className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-text-muted hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
