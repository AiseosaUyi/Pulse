// Fabrication + voice-compliance guard for generated blog content.
// Tenant-agnostic: every tenant's generated posts run through this before
// they're allowed to publish. Not a quality score — a trust/legal gate.
// Any hit blocks publish until a human explicitly clears it (see
// `content_flags_cleared` in blog_posts, mig 093).

import type { BrandVoice } from "@/lib/ai/brand-voice";

export type ContentFlagType =
  | "unverified_stat"
  | "time_guarantee"
  | "named_testimonial"
  | "competitor_price"
  | "banned_dash";

export interface ContentFlag {
  type: ContentFlagType;
  message: string;
  excerpt: string;
}

function excerptAround(content: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(content.length, index + length + 30);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < content.length ? "…" : "";
  return `${prefix}${content.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

function findAll(content: string, pattern: RegExp, build: (m: RegExpExecArray) => ContentFlag): ContentFlag[] {
  const flags: ContentFlag[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    flags.push(build(m));
    if (m[0].length === 0) re.lastIndex++; // guard against zero-width infinite loop
  }
  return flags;
}

/**
 * Universal fabrication scan — applies to every tenant regardless of
 * brand voice config. Heuristic and intentionally over-inclusive: a
 * false positive just means a human reviews it, which is the safe
 * failure mode for claims about money, time, and real people.
 */
export function scanForFabrication(content: string): ContentFlag[] {
  const flags: ContentFlag[] = [];

  // Percentages/rates stated as fact ("96% of orders", "1.5% out of stock").
  flags.push(
    ...findAll(content, /\b\d{1,3}(?:\.\d+)?%/g, (m) => ({
      type: "unverified_stat",
      message: `Percentage stated as fact: "${m[0]}" — verify against a real source or replace with a [VERIFY: ...] placeholder.`,
      excerpt: excerptAround(content, m.index, m[0].length),
    }))
  );

  // Time guarantees ("within 30 minutes", "in under 2 hours", "cold in 30 minutes").
  flags.push(
    ...findAll(
      content,
      /\b(?:within|in under|in less than)\s+\d+\s*(?:minutes?|mins?|hours?|hrs?)\b|\b\d+\s*-?\s*minutes?\b(?=[^.]{0,20}\b(?:delivery|cold|arrive|ready)\b)/gi,
      (m) => ({
        type: "time_guarantee",
        message: `Time guarantee stated as fact: "${m[0]}" — only use if this is a real, documented SLA.`,
        excerpt: excerptAround(content, m.index, m[0].length),
      })
    )
  );

  // Quoted testimonials with an attributed name ("Natasha, a Surulere planner").
  flags.push(
    ...findAll(
      content,
      /\b[A-Z][a-z]+,\s+(?:a|an|who)\b[^.\n]{0,80}/g,
      (m) => ({
        type: "named_testimonial",
        message: `Looks like a named testimonial: "${m[0].trim()}" — confirm this is a real, collected customer quote, not invented.`,
        excerpt: excerptAround(content, m.index, m[0].length),
      })
    )
  );

  // Competitor prices stated as fact (₦ or N-prefixed Naira figures, or explicit price ranges).
  flags.push(
    ...findAll(content, /₦\s?\d[\d,]*(?:\s*-\s*₦?\s?\d[\d,]*)?|\bN\d[\d,]{2,}(?:\s*-\s*N?\d[\d,]{2,})?\b/g, (m) => ({
      type: "competitor_price",
      message: `Specific price stated as fact: "${m[0]}" — verify this is real pricing data, not invented.`,
      excerpt: excerptAround(content, m.index, m[0].length),
    }))
  );

  return flags;
}

/**
 * Voice-driven mechanical checks — currently just em/en-dash usage,
 * gated on whether *this tenant's own* dont_list forbids it. Doesn't
 * hardcode any tenant; reads the rule from brand voice config so it
 * scales to every tenant that has (or hasn't) opted into the rule.
 */
export function scanForVoiceViolations(content: string, voice: BrandVoice | null): ContentFlag[] {
  if (!voice) return [];
  const forbidsDashes = voice.dont_list.some((rule) => /\b(em|en)[\s-]?dash(es)?\b/i.test(rule));
  if (!forbidsDashes) return [];

  return findAll(content, /[—–]/g, (m) => ({
    type: "banned_dash",
    message: `Em/en dash used — this tenant's brand voice forbids it ("reads as AI written").`,
    excerpt: excerptAround(content, m.index, m[0].length),
  }));
}

export function scanBlogContent(content: string, voice: BrandVoice | null): ContentFlag[] {
  return [...scanForFabrication(content), ...scanForVoiceViolations(content, voice)];
}

/**
 * Deterministic auto-fix for the one flag type that's mechanically safe
 * to correct without an LLM: em/en dashes. Only runs when the tenant's
 * dont_list actually forbids them (see scanForVoiceViolations). Replaces
 * with a comma, the safe general-purpose substitution for the parenthetical
 * "—" the model reaches for.
 */
export function stripBannedDashes(content: string, voice: BrandVoice | null): string {
  if (!voice) return content;
  const forbidsDashes = voice.dont_list.some((rule) => /\b(em|en)[\s-]?dash(es)?\b/i.test(rule));
  if (!forbidsDashes) return content;
  return content.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",");
}
