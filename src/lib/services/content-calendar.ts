import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rowToSlot } from "@/lib/services/content-calendar-lifecycle";
import type { ContentSlotRecord } from "@/lib/types/content-calendar";

// Read path for the queue-view page — uses the RLS-respecting server
// client (is_tenant_member policy), same convention as other page-level
// service reads. Staleness auto-retire is a write, so it happens via the
// admin-client lifecycle helpers (called from the page/action layer, not
// here) — this function is a pure read.
export async function listContentSlots(
  tenantSlug: string
): Promise<ContentSlotRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_slots")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("position", { ascending: true });

  if (error || !data) return [];
  return data.map(rowToSlot);
}

/** Client-injected twin for /api/v1 + MCP. Callers must run
 * rolloverOverdueSlots(admin, tenantSlug) first if "upcoming" should
 * reflect today's rolled-forward dates — this function is a pure read,
 * same as listContentSlots(). */
export async function listContentSlotsApi(
  client: SupabaseClient,
  tenantSlug: string
): Promise<ContentSlotRecord[]> {
  const { data, error } = await client
    .from("content_slots")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .order("position", { ascending: true });
  if (error || !data) return [];
  return data.map(rowToSlot);
}
