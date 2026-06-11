"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentTenant, requireUser } from "@/lib/auth";
import {
  getWhatsappAccount,
  sendWhatsappText,
  sendWhatsappTemplate,
} from "@/lib/integrations/whatsapp";
import { generateLinkCode } from "@/lib/attribution/links";

type Result<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export async function createBroadcastList(
  name: string,
  description?: string
): Promise<Result<{ id: string }>> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  if (!name.trim()) return { success: false, error: "Name required" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("broadcast_lists")
    .insert({
      tenant_slug: tenant.slug,
      name: name.trim(),
      description: description?.trim() || null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { success: false, error: error?.message ?? "Failed" };
  revalidatePath("/broadcasts");
  return { success: true, id: data.id };
}

export async function addBroadcastMembers(
  listId: string,
  members: Array<{ phone: string; name?: string }>
): Promise<Result<{ added: number }>> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const rows = members
    .map((m) => ({
      list_id: listId,
      tenant_slug: tenant.slug,
      phone: m.phone.trim(),
      name: m.name?.trim() || null,
    }))
    .filter((m) => m.phone);
  if (rows.length === 0) return { success: false, error: "No valid phone numbers" };

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("broadcast_list_members")
    .upsert(rows, { onConflict: "list_id,phone" })
    .select("id");
  if (error) return { success: false, error: error.message };
  revalidatePath("/broadcasts");
  return { success: true, added: data?.length ?? 0 };
}

// Send a broadcast to every member of a list. If `ctaUrl` is given, a tracked
// /r/:code short link (utm_campaign=broadcast:<id>) replaces the literal {link}
// token in the body so clicks → orders are attributable. Uses a template when
// `templateName` is set (required outside the 24h window), else free-text.
export async function sendBroadcast(input: {
  listId: string;
  body: string;
  ctaUrl?: string;
  templateName?: string;
}): Promise<Result<{ sent: number; failed: number }>> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  const account = await getWhatsappAccount(tenant.slug);
  if (!account) {
    return {
      success: false,
      error: "WhatsApp isn't connected for this workspace",
    };
  }

  const supabase = await createClient();
  const admin = createAdminClient();

  const { data: members } = await supabase
    .from("broadcast_list_members")
    .select("phone")
    .eq("list_id", input.listId)
    .eq("opted_out", false);
  const phones = (members ?? []).map((m) => (m as { phone: string }).phone);
  if (phones.length === 0) return { success: false, error: "List has no members" };

  // Record the message row first so we have an id for the campaign tag.
  const { data: msg, error: msgErr } = await supabase
    .from("broadcast_messages")
    .insert({
      tenant_slug: tenant.slug,
      list_id: input.listId,
      template_name: input.templateName ?? null,
      body: input.body,
      status: "sending",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (msgErr || !msg) return { success: false, error: msgErr?.message ?? "Failed" };

  // Build a tracked link once (shared across the broadcast).
  let linkId: string | null = null;
  let shortUrl: string | null = null;
  if (input.ctaUrl) {
    const code = generateLinkCode();
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const { data: link } = await admin
      .from("links")
      .insert({
        tenant_slug: tenant.slug,
        code,
        destination_url: input.ctaUrl,
        utm_source: "whatsapp",
        utm_medium: "broadcast",
        utm_campaign: `broadcast:${msg.id}`,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (link && base) {
      linkId = link.id;
      shortUrl = `${base}/r/${code}`;
    }
  }

  const body = shortUrl
    ? input.body.replace(/\{link\}/g, shortUrl)
    : input.body;

  let sent = 0;
  let failed = 0;
  for (const phone of phones) {
    const res = input.templateName
      ? await sendWhatsappTemplate(account, phone, input.templateName, "en", [body])
      : await sendWhatsappText(account, phone, body);
    if (res.ok) sent += 1;
    else failed += 1;
  }

  await admin
    .from("broadcast_messages")
    .update({
      status: failed === 0 ? "sent" : sent > 0 ? "sent" : "failed",
      sent_count: sent,
      failed_count: failed,
      link_id: linkId,
      sent_at: new Date().toISOString(),
    })
    .eq("id", msg.id);

  revalidatePath("/broadcasts");
  return { success: true, sent, failed };
}
