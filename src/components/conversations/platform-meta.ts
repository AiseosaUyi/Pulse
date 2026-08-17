// Single icon/label map for conversation channels — the only place channel
// differences live (per the plan). lucide-react ships no brand-mark icons
// in this repo's version, so these are deliberately generic stand-ins,
// matching the icon `MessageCircle` already used for WhatsApp elsewhere
// (WhatsAppConnectCard.tsx).

import {
  Camera,
  Music2,
  AtSign,
  Briefcase,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import type { ConversationPlatform } from "@/lib/types/conversations";

export interface PlatformMeta {
  label: string;
  icon: LucideIcon;
  /** Text color utility for the icon/badge. */
  colorClass: string;
}

export const PLATFORM_META: Record<ConversationPlatform, PlatformMeta> = {
  instagram: { label: "Instagram", icon: Camera, colorClass: "text-primary-500" },
  tiktok: { label: "TikTok", icon: Music2, colorClass: "text-foreground" },
  twitter: { label: "Twitter/X", icon: AtSign, colorClass: "text-status-teal" },
  linkedin: { label: "LinkedIn", icon: Briefcase, colorClass: "text-blue-500" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, colorClass: "text-status-green" },
};

export function platformMeta(platform: string): PlatformMeta {
  return PLATFORM_META[platform as ConversationPlatform] ?? {
    label: platform,
    icon: MessageCircle,
    colorClass: "text-text-muted",
  };
}
