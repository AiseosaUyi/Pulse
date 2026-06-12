"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant, requireUser } from "@/lib/auth";

type Result = { success: true } | { success: false; error: string };

// Connect (or update) this workspace's WhatsApp number. Owner/admin only — the
// access token is server-side secret material, written via the RLS-gated
// table. Any tenant can connect its own number; routing is by phone_number_id.
export async function saveWhatsappAccount(input: {
  phoneNumberId: string;
  accessToken: string;
  displayPhone?: string;
  defaultTemplate?: string;
}): Promise<Result> {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return { success: false, error: "Owners and admins only" };
  }
  if (!input.phoneNumberId.trim() || !input.accessToken.trim()) {
    return { success: false, error: "Phone number id and access token are required" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("whatsapp_accounts").upsert(
    {
      tenant_slug: tenant.slug,
      phone_number_id: input.phoneNumberId.trim(),
      access_token: input.accessToken.trim(),
      display_phone: input.displayPhone?.trim() || null,
      default_template: input.defaultTemplate?.trim() || null,
      status: "connected",
      last_error: null,
      created_by: user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_slug" }
  );
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/integrations");
  revalidatePath("/broadcasts");
  return { success: true };
}

export async function disconnectWhatsappAccount(): Promise<Result> {
  await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return { success: false, error: "Owners and admins only" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("whatsapp_accounts")
    .update({ status: "disconnected" })
    .eq("tenant_slug", tenant.slug);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/integrations");
  return { success: true };
}
