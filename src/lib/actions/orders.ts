"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant, requireUser } from "@/lib/auth";

const CHANNELS = ["web", "whatsapp", "dm", "phone"] as const;
const STATUSES = ["created", "paid", "fulfilled", "refunded", "cancelled"] as const;

type ActionResult = { success: true; id: string } | { success: false; error: string };

// Manual order entry for WhatsApp / DM / phone sales the marketer logs by hand,
// so off-web orders still flow into the attribution funnel. Webhook orders come
// in via /api/orders/webhook; this is the human path.
export async function createManualOrder(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const channelRaw = String(formData.get("channel") ?? "whatsapp");
  const channel = (CHANNELS as readonly string[]).includes(channelRaw)
    ? channelRaw
    : "whatsapp";
  const statusRaw = String(formData.get("status") ?? "paid");
  const status = (STATUSES as readonly string[]).includes(statusRaw)
    ? statusRaw
    : "paid";

  const amountRaw = String(formData.get("amount") ?? "").trim();
  const amount = amountRaw ? Number(amountRaw) : null;
  if (amount != null && !Number.isFinite(amount)) {
    return { success: false, error: "Amount must be a number" };
  }

  const utmCampaign = String(formData.get("utm_campaign") ?? "").trim() || null;
  const source = String(formData.get("source") ?? "").trim() || "manual";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .insert({
      tenant_slug: tenant.slug,
      channel,
      status,
      amount,
      currency: String(formData.get("currency") ?? "NGN").trim() || "NGN",
      utm_campaign: utmCampaign,
      source,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: error?.message ?? "Could not log order" };
  }

  // Mirror the webhook's event trail.
  await supabase.from("order_events").insert({
    order_id: data.id,
    tenant_slug: tenant.slug,
    event: status,
    meta: { entry: "manual" },
  });

  revalidatePath("/orders");
  revalidatePath("/dashboard");
  return { success: true, id: data.id };
}
