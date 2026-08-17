// Read layer for settings.sharedInbox (Track A Phase 3). Mirrors
// lib/cadence/config.ts's getCadenceConfig shape, but accepts the caller's
// client rather than hardcoding admin — lib/ai/shared-inbox-auto-reply.ts's
// system-actor code passes an admin client (no session to scope RLS to);
// the settings page passes the session-scoped RLS client.

import type { SupabaseClient } from "@supabase/supabase-js";
import { sharedInboxConfigSchema, defaultSharedInboxConfig, type SharedInboxConfig } from "@/lib/shared-inbox/types";

export async function getSharedInboxConfig(
  client: SupabaseClient,
  tenantSlug: string
): Promise<SharedInboxConfig> {
  const { data, error } = await client
    .from("tenants")
    .select("settings")
    .eq("slug", tenantSlug)
    .maybeSingle();
  if (error || !data?.settings) return defaultSharedInboxConfig();

  const parsed = sharedInboxConfigSchema.safeParse(
    (data.settings as { sharedInbox?: unknown }).sharedInbox
  );
  return parsed.success ? parsed.data : defaultSharedInboxConfig();
}
