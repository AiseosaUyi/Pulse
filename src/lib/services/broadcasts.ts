// WhatsApp broadcast read layer. Server (RLS-scoped) client.

import { createClient } from "@/lib/supabase/server";

export interface BroadcastList {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
}

export interface BroadcastMessage {
  id: string;
  listId: string | null;
  body: string;
  status: string;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  sentAt: string | null;
}

export async function listBroadcastLists(
  tenantSlug: string
): Promise<BroadcastList[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("broadcast_lists")
    .select("id, name, description, created_at, broadcast_list_members(count)")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (
    data as Array<{
      id: string;
      name: string;
      description: string | null;
      created_at: string;
      broadcast_list_members: Array<{ count: number }>;
    }>
  ).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    memberCount: r.broadcast_list_members?.[0]?.count ?? 0,
    createdAt: r.created_at,
  }));
}

export interface WhatsappConnectionStatus {
  connected: boolean;
  displayPhone: string | null;
  lastError: string | null;
}

// Whether this tenant has a live WhatsApp Cloud API number wired up
// (whatsapp_accounts, migration 058). Broadcasts silently fail without one,
// so pages that send/preview broadcasts need this to explain why.
export async function getWhatsappConnectionStatus(
  tenantSlug: string
): Promise<WhatsappConnectionStatus> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("whatsapp_accounts")
    .select("status, display_phone, last_error")
    .eq("tenant_slug", tenantSlug)
    .maybeSingle();
  if (!data) return { connected: false, displayPhone: null, lastError: null };
  const row = data as {
    status: string;
    display_phone: string | null;
    last_error: string | null;
  };
  return {
    connected: row.status === "connected",
    displayPhone: row.display_phone,
    lastError: row.last_error,
  };
}

export async function listBroadcastMessages(
  tenantSlug: string,
  limit = 50
): Promise<BroadcastMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("broadcast_messages")
    .select("id, list_id, body, status, sent_count, failed_count, created_at, sent_at")
    .eq("tenant_slug", tenantSlug)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (
    data as Array<{
      id: string;
      list_id: string | null;
      body: string;
      status: string;
      sent_count: number;
      failed_count: number;
      created_at: string;
      sent_at: string | null;
    }>
  ).map((r) => ({
    id: r.id,
    listId: r.list_id,
    body: r.body,
    status: r.status,
    sentCount: r.sent_count,
    failedCount: r.failed_count,
    createdAt: r.created_at,
    sentAt: r.sent_at,
  }));
}
