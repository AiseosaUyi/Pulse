// Trackable short links. At publish time we rewrite every URL in a caption to
// a Pulse /r/:code link that 302s to the original with UTM params appended and
// logs a click. This captures clicks from IG-bio/story and WhatsApp, where raw
// UTMs aren't visible or measurable, before GA4 is connected.

import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export interface UtmParams {
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
}

// 7 url-safe chars ≈ 10^12 space — collision-resistant at our volume, and the
// code column is uniquely indexed so a dup insert simply errors and we retry.
export function generateLinkCode(): string {
  return randomBytes(8).toString("base64url").slice(0, 7);
}

export function appendUtm(url: string, utm: UtmParams): string {
  try {
    const u = new URL(url);
    if (utm.utm_source) u.searchParams.set("utm_source", utm.utm_source);
    if (utm.utm_medium) u.searchParams.set("utm_medium", utm.utm_medium);
    if (utm.utm_campaign) u.searchParams.set("utm_campaign", utm.utm_campaign);
    if (utm.utm_content) u.searchParams.set("utm_content", utm.utm_content);
    return u.toString();
  } catch {
    return url; // not an absolute URL — leave untouched
  }
}

const URL_RE = /https?:\/\/[^\s)]+/g;

interface RewriteContext extends UtmParams {
  tenantSlug: string;
  postId?: string | null;
  scheduledPostId?: string | null;
  createdBy?: string | null;
}

/**
 * Rewrite every absolute URL in `text` to a Pulse short link, persisting one
 * `links` row per destination. Returns the rewritten text. Best-effort: if a
 * link row can't be created, that URL is left as-is so publishing never blocks.
 */
export async function applyTrackingLinks(
  text: string | null | undefined,
  ctx: RewriteContext
): Promise<string> {
  if (!text) return text ?? "";
  const urls = [...new Set(text.match(URL_RE) ?? [])];
  if (urls.length === 0) return text;

  const admin = createAdminClient();
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  let rewritten = text;

  for (const dest of urls) {
    const code = generateLinkCode();
    const { error } = await admin.from("links").insert({
      tenant_slug: ctx.tenantSlug,
      code,
      post_id: ctx.postId ?? null,
      scheduled_post_id: ctx.scheduledPostId ?? null,
      destination_url: dest,
      utm_source: ctx.utm_source ?? null,
      utm_medium: ctx.utm_medium ?? null,
      utm_campaign: ctx.utm_campaign ?? null,
      utm_content: ctx.utm_content ?? null,
      created_by: ctx.createdBy ?? null,
    });
    if (error || !base) continue; // leave the original URL in place
    rewritten = rewritten.split(dest).join(`${base}/r/${code}`);
  }

  return rewritten;
}
