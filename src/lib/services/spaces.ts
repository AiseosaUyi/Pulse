// X/Twitter Space capture. Extraction runs on the user's own machine
// (scripts/space-capture/download_space.sh — needs a logged-in X session
// and a long-running download, see docs/space-capture-setup.md); this
// service just creates/completes the saved_content row and issues an R2
// presigned upload URL so the finished mp3 can go straight to storage.
// Shared by the REST /api/v1/spaces routes and the pulse_capture_space /
// pulse_complete_space MCP tools — wraps the same functions, doesn't
// duplicate the logic.

import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import { createR2PresignedPut, isR2Configured, r2ObjectExists } from "@/lib/storage/r2";

type Admin = ReturnType<typeof createAdminClient>;

const SPACE_URL_PATTERN =
  /^https:\/\/(www\.)?(x\.com|twitter\.com|mobile\.twitter\.com)\/i\/spaces\/\w+/i;

export const captureSpaceInputSchema = z.object({
  spaceUrl: z.string().regex(SPACE_URL_PATTERN, "spaceUrl must be an x.com/twitter.com Space URL"),
  title: z.string().trim().min(1).max(300).nullable().optional(),
  hostHandle: z.string().trim().min(1).max(100).nullable().optional(),
  durationS: z
    .number()
    .int()
    .positive()
    .max(60 * 60 * 12)
    .nullable()
    .optional(),
  transcript: z.string().max(500_000).nullable().optional(),
});
export type CaptureSpaceInput = z.infer<typeof captureSpaceInputSchema>;

/** Same "assets/{tenant}/..." prefix the rest of vault/saved content uses
 * (see src/lib/storage/r2.ts) so existing R2-path helpers — publicUrlFor(),
 * isLegacySupabasePath() — recognize it without special-casing. */
export function spaceStoragePath(tenantSlug: string, captureId: string): string {
  return `assets/${tenantSlug}/spaces/${captureId}.mp3`;
}

export async function createSpaceCaptureApi(
  admin: Admin,
  tenantSlug: string,
  createdBy: string | null,
  input: CaptureSpaceInput
): Promise<{ captureId: string; uploadUrl: string } | { error: string; status: 500 }> {
  if (!isR2Configured()) {
    return { error: "Storage is not configured (R2 env vars missing)", status: 500 };
  }

  const { data: row, error } = await admin
    .from("saved_content")
    .insert({
      tenant_slug: tenantSlug,
      title: input.title || "Untitled Space",
      source_platform: "twitter",
      source_url: input.spaceUrl,
      author_handle: input.hostHandle ?? null,
      duration_sec: input.durationS ?? null,
      notes: input.transcript || null,
      extraction_status: "pending", // Waiting for completeSpaceCaptureApi
      saved_by: createdBy,
    })
    .select("id")
    .single();

  if (error || !row) {
    return { error: "Failed to create capture record", status: 500 };
  }

  const captureId = row.id as string;
  const storagePath = spaceStoragePath(tenantSlug, captureId);

  try {
    const uploadUrl = await createR2PresignedPut(storagePath, "audio/mpeg");
    return { captureId, uploadUrl };
  } catch (err) {
    // Don't leave an orphaned "pending" row behind if we can't even hand
    // back an upload URL.
    await admin.from("saved_content").delete().eq("id", captureId);
    return {
      error: `Failed to generate upload URL: ${err instanceof Error ? err.message : String(err)}`,
      status: 500,
    };
  }
}

export async function completeSpaceCaptureApi(
  admin: Admin,
  tenantSlug: string,
  captureId: string
): Promise<{ success: true } | { error: string; status: 404 | 409 | 500 }> {
  const { data: existing, error: findError } = await admin
    .from("saved_content")
    .select("id")
    .eq("id", captureId)
    .eq("tenant_slug", tenantSlug)
    .single();

  if (findError || !existing) {
    return { error: "Capture not found", status: 404 };
  }

  const storagePath = spaceStoragePath(tenantSlug, captureId);

  // Guard against a client calling complete without the PUT to the
  // presigned URL actually having landed — otherwise we'd mark the row
  // "extracted" with nothing at storagePath.
  const uploaded = await r2ObjectExists(storagePath);
  if (!uploaded) {
    return {
      error: "No file found at the expected storage location — did the upload PUT to uploadUrl succeed?",
      status: 409,
    };
  }

  const { error } = await admin
    .from("saved_content")
    .update({
      extraction_status: "extracted",
      stored_path: storagePath,
      stored_mime: "audio/mpeg",
    })
    .eq("id", captureId);

  if (error) {
    return { error: "Failed to complete capture", status: 500 };
  }

  return { success: true };
}
