"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";
import type { OutboundPlatform } from "@/lib/types/outbound";
import { OUTBOUND_PLATFORMS } from "@/lib/types/outbound";

export interface ImportProspectRow {
  handle: string;
  platform: OutboundPlatform;
  displayName?: string | null;
  bio?: string | null;
  notes?: string | null;
  profileUrl?: string | null;
  followerCount?: number | null;
  category?: string | null;
  location?: string | null;
  verifiedName?: string | null;
  eventTitle?: string | null;
  phone?: string | null;
  lastReachoutAt?: string | null;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; handle: string; reason: string }>;
}

function normaliseHandle(raw: string): string {
  return raw.replace(/^@/, "").trim().toLowerCase();
}

function normalisePlatform(raw: string): OutboundPlatform | null {
  const s = raw.trim().toLowerCase();
  const MAP: Record<string, OutboundPlatform> = {
    instagram: "instagram",
    ig: "instagram",
    tiktok: "tiktok",
    tt: "tiktok",
    twitter: "twitter",
    x: "twitter",
    linkedin: "linkedin",
    li: "linkedin",
    manual: "manual",
    other: "other",
  };
  if (MAP[s]) return MAP[s];
  if ((OUTBOUND_PLATFORMS as readonly string[]).includes(s)) return s as OutboundPlatform;
  return null;
}

export async function checkExistingHandles(
  tenantSlug: string,
  rows: Array<{ handle: string; platform: string }>
): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const admin = createAdminClient();
  const handles = rows.map((r) => r.handle.replace(/^@/, "").trim().toLowerCase());
  const { data } = await admin
    .from("prospects")
    .select("handle, platform")
    .eq("tenant_slug", tenantSlug)
    .in("handle", handles);
  return (data ?? []).map((r) => `${r.handle}:${r.platform}`);
}

export async function importProspects(
  tenantSlug: string,
  rows: ImportProspectRow[]
): Promise<{ success: true; result: ImportResult } | { success: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };
  if (!rows.length) return { success: false, error: "No rows provided" };

  const admin = createAdminClient();
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const now = new Date().toISOString();

  // Normalise every row at the server boundary (handle: strip @, platform: alias map)
  const normalised = rows.map((r) => ({
    ...r,
    handle: normaliseHandle(r.handle),
    platform: normalisePlatform(r.platform as string) ?? r.platform,
  }));

  // Process in batches of 50 to stay within PostgREST limits
  const BATCH = 50;
  for (let i = 0; i < normalised.length; i += BATCH) {
    const batch = normalised.slice(i, i + BATCH);

    // Check which (handle, platform) already exist
    const handles = batch.map((r) => r.handle);
    const { data: existing } = await admin
      .from("prospects")
      .select("id, handle, platform")
      .eq("tenant_slug", tenantSlug)
      .in("handle", handles);

    const existingSet = new Set(
      (existing ?? []).map((r) => `${r.handle}:${r.platform}`)
    );

    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: { id?: string; row: ImportProspectRow }[] = [];

    for (const row of batch) {
      const key = `${row.handle}:${row.platform}`;
      const existingRow = (existing ?? []).find(
        (r) => r.handle === row.handle && r.platform === row.platform
      );
      if (existingSet.has(key) && existingRow) {
        toUpdate.push({ id: existingRow.id as string, row });
      } else {
        toInsert.push({
          tenant_slug: tenantSlug,
          handle: row.handle,
          platform: row.platform,
          display_name: row.displayName ?? null,
          bio: row.bio ?? null,
          notes: row.notes ?? null,
          profile_url: row.profileUrl ?? null,
          follower_count: row.followerCount ?? null,
          category: row.category ?? null,
          location: row.location ?? null,
          verified_name: row.verifiedName ?? null,
          event_title: row.eventTitle ?? null,
          phone: row.phone ?? null,
          last_reachout_at: row.lastReachoutAt ?? null,
          status: "new",
          signal_data: {},
          created_at: now,
          updated_at: now,
        });
      }
    }

    if (toInsert.length > 0) {
      // Dedup within this batch — keep LAST occurrence per (handle, platform) so
      // sheet duplicates don't cause a unique constraint error that drops the batch.
      const batchMap = new Map<string, Record<string, unknown>>();
      for (const row of toInsert) {
        batchMap.set(`${row.handle}:${row.platform}`, row);
      }
      const dedupedInsert = Array.from(batchMap.values());

      // UPSERT instead of INSERT — if any conflict slips through (race condition,
      // edge case), the row is updated rather than the entire batch being dropped.
      const { error } = await admin
        .from("prospects")
        .upsert(dedupedInsert, { onConflict: "tenant_slug,platform,handle" });

      if (error) {
        for (const r of dedupedInsert) {
          result.errors.push({
            row: normalised.findIndex((x) => x.handle === r.handle) + 1,
            handle: r.handle as string,
            reason: error.message,
          });
        }
      } else {
        result.created += dedupedInsert.length;
      }
    }

    for (const { id, row } of toUpdate) {
      // Only update non-null incoming fields
      const patch: Record<string, unknown> = { updated_at: now };
      if (row.displayName) patch.display_name = row.displayName;
      if (row.bio) patch.bio = row.bio;
      if (row.notes) patch.notes = row.notes;
      if (row.profileUrl) patch.profile_url = row.profileUrl;
      if (row.followerCount != null) patch.follower_count = row.followerCount;
      if (row.category) patch.category = row.category;
      if (row.location) patch.location = row.location;
      if (row.verifiedName) patch.verified_name = row.verifiedName;
      if (row.eventTitle) patch.event_title = row.eventTitle;
      if (row.phone) patch.phone = row.phone;
      if (row.lastReachoutAt) patch.last_reachout_at = row.lastReachoutAt;

      const { error } = await admin
        .from("prospects")
        .update(patch)
        .eq("id", id)
        .eq("tenant_slug", tenantSlug);

      if (error) {
        result.errors.push({
          row: normalised.findIndex((x) => x.handle === row.handle) + 1,
          handle: row.handle,
          reason: error.message,
        });
      } else {
        result.updated += 1;
      }
    }
  }

  return { success: true, result };
}
