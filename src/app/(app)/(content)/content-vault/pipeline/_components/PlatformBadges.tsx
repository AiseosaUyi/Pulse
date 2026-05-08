// Inline SVG brand icons. lucide-react 1.x in this project doesn't
// ship brand glyphs, so we draw them ourselves at the size the table
// needs. Pixels-perfect at 12-16px, tinted with the platform's
// canonical color. Paths sourced from simple-icons (CC0).

import type { ContentPlatform } from "@/lib/types/content-pipeline";

const FULL_LABEL: Record<ContentPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
  email: "Email",
};

// Each badge is a 20×20 rounded chip with the brand glyph centered.
// Tints chosen from official brand color palettes; subtle enough to
// sit comfortably alongside the rest of Pulse's maroon UI.
const BG: Record<ContentPlatform, string> = {
  instagram: "bg-[#E4405F]/12 text-[#C13584]",
  tiktok: "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100",
  linkedin: "bg-[#0A66C2]/12 text-[#0A66C2]",
  x: "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100",
  facebook: "bg-[#1877F2]/12 text-[#1877F2]",
  whatsapp: "bg-[#25D366]/15 text-[#128C7E]",
  email: "bg-amber-100 text-amber-700",
};

function Glyph({ p }: { p: ContentPlatform }) {
  switch (p) {
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
          <path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23a3.71 3.71 0 0 1-.9 1.38c-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.71 3.71 0 0 1-1.38-.9 3.71 3.71 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.34 4.14.63a5.86 5.86 0 0 0-2.13 1.38A5.86 5.86 0 0 0 .63 4.14C.34 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.27 2.15.56 2.91.3.79.7 1.46 1.38 2.13a5.86 5.86 0 0 0 2.13 1.38c.76.29 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.27 2.91-.56a5.86 5.86 0 0 0 2.13-1.38 5.86 5.86 0 0 0 1.38-2.13c.29-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.27-2.15-.56-2.91a5.86 5.86 0 0 0-1.38-2.13A5.86 5.86 0 0 0 19.86.63c-.76-.29-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zm0 10.16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.41-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z" />
        </svg>
      );
    case "tiktok":
      return (
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
          <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
          <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.95v5.66H9.36V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45C23.2 24 24 23.23 24 22.28V1.72C24 .77 23.2 0 22.22 0z" />
        </svg>
      );
    case "x":
      return (
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
          <path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.69.24 2.69.24v2.97h-1.52c-1.49 0-1.95.93-1.95 1.88v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
          <path d="M17.47 14.38c-.3-.15-1.74-.86-2-.96-.27-.1-.47-.15-.66.15s-.76.96-.94 1.16c-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.39-1.47-.88-.79-1.48-1.76-1.65-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52s-.66-1.6-.91-2.18c-.24-.57-.49-.5-.66-.51-.17-.01-.37-.01-.57-.01s-.52.07-.79.37c-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.87 1.22 3.07.15.2 2.1 3.21 5.08 4.5.71.3 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.08 1.74-.71 1.99-1.4.25-.69.25-1.28.17-1.4-.07-.12-.27-.2-.57-.35zM12 2C6.48 2 2 6.48 2 12c0 1.76.46 3.5 1.34 5L2 22l5.13-1.34A9.96 9.96 0 0 0 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm0 18.13c-1.5 0-2.97-.4-4.26-1.16l-.31-.18-3.16.83.84-3.08-.2-.32A8.13 8.13 0 0 1 3.87 12c0-4.48 3.65-8.13 8.13-8.13S20.13 7.52 20.13 12 16.48 20.13 12 20.13z" />
        </svg>
      );
    case "email":
      return (
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
          <path d="M0 5.5v13a2 2 0 0 0 2 2h20a2 2 0 0 0 2-2v-13l-12 7.5L0 5.5zm12 6L24 4H0l12 7.5z" />
        </svg>
      );
  }
}

export function PlatformBadges({ platforms }: { platforms: ContentPlatform[] }) {
  if (!platforms || platforms.length === 0) {
    return <span className="text-text-muted text-xs">No socials</span>;
  }
  return (
    <div className="flex items-center gap-1">
      {platforms.map((p) => (
        <span
          key={p}
          title={FULL_LABEL[p]}
          className={`w-5 h-5 rounded-md flex items-center justify-center ${BG[p]}`}
        >
          <Glyph p={p} />
        </span>
      ))}
    </div>
  );
}
