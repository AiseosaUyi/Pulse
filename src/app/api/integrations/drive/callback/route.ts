// Drive OAuth callback. Verifies state cookie, exchanges code →
// tokens, bootstraps /Pulse + section folders in the user's Drive,
// stores the connection. Redirects back to /settings/integrations
// with a success or error param.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { exchangeCodeForTokens, ensureFolder } from "@/lib/integrations/drive";
import { upsertDriveConnection } from "@/lib/services/drive-connections";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_CONTENT_SECTIONS,
  DEFAULT_CONTENT_TYPES,
} from "@/lib/types/content-pipeline";

const STATE_COOKIE = "pulse_drive_oauth_state";

function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return new URL(path, base).toString();
}

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const cookieStore = await cookies();
  const stored = cookieStore.get(STATE_COOKIE)?.value ?? "";
  // One-shot — clear the cookie either way
  cookieStore.delete(STATE_COOKIE);

  if (oauthError) {
    return NextResponse.redirect(
      appUrl(`/settings/integrations?drive_error=${encodeURIComponent(oauthError)}`)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      appUrl("/settings/integrations?drive_error=missing_code")
    );
  }

  if (!stored || !constantTimeEquals(stored, state)) {
    return NextResponse.redirect(
      appUrl("/settings/integrations?drive_error=state_mismatch")
    );
  }

  // payload format: nonce.tenantSlug.userId
  const parts = state.split(".");
  if (parts.length !== 3) {
    return NextResponse.redirect(
      appUrl("/settings/integrations?drive_error=bad_state")
    );
  }
  const [, tenantSlug, userId] = parts;

  try {
    const tokens = await exchangeCodeForTokens(code);

    // Bootstrap /Pulse + section folders before storing the
    // connection — if folder creation fails we want the user to
    // see the error and retry, not be left with a half-set-up
    // connection.
    const pulseFolder = await ensureFolder(
      tokens.access_token,
      "Pulse",
      "root"
    );

    await upsertDriveConnection({
      tenantSlug,
      tokens,
      connectedByUserId: userId,
      rootFolderId: pulseFolder.id,
    });

    // Section folders + DB rows
    const admin = createAdminClient();
    for (const section of DEFAULT_CONTENT_SECTIONS) {
      const folder = await ensureFolder(
        tokens.access_token,
        section.label,
        pulseFolder.id
      );
      await admin.from("content_sections").upsert(
        {
          tenant_slug: tenantSlug,
          slug: section.slug,
          label: section.label,
          drive_folder_id: folder.id,
          sort_order: section.sortOrder,
        },
        { onConflict: "tenant_slug,slug" }
      );
    }

    // Seed default content types (idempotent — onConflict no-op)
    const typeRows = DEFAULT_CONTENT_TYPES.map((t) => ({
      tenant_slug: tenantSlug,
      slug: t.slug,
      label: t.label,
      is_default: true,
      created_by: userId,
    }));
    await admin
      .from("content_types")
      .upsert(typeRows, { onConflict: "tenant_slug,slug" });

    return NextResponse.redirect(
      appUrl("/settings/integrations?drive_connected=1")
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(
      appUrl(
        `/settings/integrations?drive_error=${encodeURIComponent(message)}`
      )
    );
  }
}
