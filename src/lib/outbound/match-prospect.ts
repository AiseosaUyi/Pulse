// Matches an inbound message (WhatsApp, Instagram DM, ...) to the one
// prospect it came from, so the reply can flow into Outbound instead of
// only showing in Conversations.
//
// Rules:
//   - Only ever looks inside the tenant the caller passes. The caller takes
//     the tenant from the connection/account record that received the
//     message, never from the message itself.
//   - WhatsApp: the sender's phone, normalised to E.164 (normalizePhone),
//     compared against prospects.phone normalised the same way, on any
//     prospect platform (a phone is not tied to a social platform).
//   - Instagram / TikTok: the sender's handle (lowercase, no leading @)
//     compared against prospects.handle on that same platform.
//   - Prospects marked as a duplicate of another (duplicate_of_id) are
//     ignored, so a merged pair still matches the surviving row.
//   - Zero matches or more than one distinct prospect -> null. Never guess.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeHandle, normalizePhone } from "@/lib/services/outreach-ledger";

export type InboundChannel = "whatsapp" | "instagram" | "tiktok";

export interface InboundSender {
  channel: InboundChannel;
  /** Raw sender phone as the provider gave it (WhatsApp `from`). */
  phone?: string | null;
  /** Raw sender handle as the provider gave it (Instagram / TikTok username). */
  handle?: string | null;
}

export interface ProspectCandidate {
  id: string;
  platform: string | null;
  handle: string | null;
  phone: string | null;
  duplicate_of_id?: string | null;
}

/** Digits-only E.164 key for comparing phones, or "" when unusable. */
export function phoneKey(input?: string | null): string {
  const e164 = normalizePhone(input);
  const digits = e164.replace(/\D/g, "");
  // Anything shorter than 8 digits is not a real phone number; refuse to
  // match on it rather than risk lining up two unrelated short codes.
  return digits.length >= 8 ? digits : "";
}

export function handleKey(input?: string | null): string {
  return normalizeHandle(input);
}

/**
 * Pure decision: which single prospect (if any) does this sender match?
 * `candidates` may be a superset (the DB pre-filter is loose on purpose);
 * this function applies the exact rules.
 */
export function pickProspectMatch(
  sender: InboundSender,
  candidates: ProspectCandidate[]
): string | null {
  const live = candidates.filter((c) => !c.duplicate_of_id);
  let hits: ProspectCandidate[];

  if (sender.channel === "whatsapp") {
    const key = phoneKey(sender.phone);
    if (!key) return null;
    hits = live.filter((c) => phoneKey(c.phone) === key);
  } else {
    const key = handleKey(sender.handle);
    if (!key) return null;
    hits = live.filter(
      (c) => (c.platform ?? "").toLowerCase() === sender.channel && handleKey(c.handle) === key
    );
  }

  const ids = new Set(hits.map((h) => h.id));
  if (ids.size !== 1) return null;
  return [...ids][0];
}

const CANDIDATE_COLUMNS = "id, platform, handle, phone, duplicate_of_id";
const CANDIDATE_LIMIT = 50;

/**
 * Looks up the prospect an inbound message came from, inside one tenant.
 * Returns the prospect id, or null when there is no single clear match.
 * Never throws: a failed lookup is treated as "no match" so the message
 * still lands in Conversations exactly as before.
 */
export async function findProspectForInbound(
  client: SupabaseClient,
  tenantSlug: string,
  sender: InboundSender
): Promise<string | null> {
  if (!tenantSlug) return null;
  try {
    let rows: ProspectCandidate[] = [];

    if (sender.channel === "whatsapp") {
      const key = phoneKey(sender.phone);
      if (!key) return null;
      // Stored phones come in many shapes (+234..., 0803..., spaced). The
      // last four digits are almost always contiguous, so pre-filter on
      // them and let pickProspectMatch do the exact E.164 compare.
      const { data, error } = await client
        .from("prospects")
        .select(CANDIDATE_COLUMNS)
        .eq("tenant_slug", tenantSlug)
        .like("phone", `%${key.slice(-4)}%`)
        .limit(CANDIDATE_LIMIT);
      if (error) return null;
      rows = (data ?? []) as ProspectCandidate[];
    } else {
      const key = handleKey(sender.handle);
      if (!key) return null;
      // Stored handles may carry a leading @ or different case; ilike on the
      // suffix catches both, the exact compare happens in pickProspectMatch.
      const { data, error } = await client
        .from("prospects")
        .select(CANDIDATE_COLUMNS)
        .eq("tenant_slug", tenantSlug)
        .eq("platform", sender.channel)
        .ilike("handle", `%${key}`)
        .limit(CANDIDATE_LIMIT);
      if (error) return null;
      rows = (data ?? []) as ProspectCandidate[];
    }

    return pickProspectMatch(sender, rows);
  } catch {
    return null;
  }
}
