// Google SERP preview — renders title + URL breadcrumb + meta exactly
// the way Google shows them. Mini variant used in cards, full variant
// in the side panel. Styled to match Google's actual SERP typography
// rather than our app styles so users can sanity-check how it reads.

import type { GooglePreview } from "@/lib/blog/google-preview";

interface Props {
  preview: GooglePreview;
  variant?: "mini" | "full";
}

export function GoogleSerpPreview({ preview, variant = "full" }: Props) {
  const isMini = variant === "mini";
  return (
    <div
      className={`bg-white dark:bg-white rounded-lg ${isMini ? "p-2.5" : "p-4"} border border-border/50`}
      style={{ fontFamily: "'arial', sans-serif" }}
    >
      <div
        className="text-[#4d5156] dark:text-[#4d5156] truncate"
        style={{ fontSize: isMini ? 10 : 12 }}
      >
        {preview.url_display}
      </div>
      <div
        className="text-[#1a0dab] dark:text-[#1a0dab] mt-0.5 line-clamp-2"
        style={{ fontSize: isMini ? 13 : 18, fontWeight: 400 }}
      >
        {preview.title_display}
      </div>
      <div
        className="text-[#4d5156] dark:text-[#4d5156] mt-0.5 line-clamp-2"
        style={{ fontSize: isMini ? 11 : 14, lineHeight: 1.45 }}
      >
        {preview.meta_display}
      </div>
    </div>
  );
}
