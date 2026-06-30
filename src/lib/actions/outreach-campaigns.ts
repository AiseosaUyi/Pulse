"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export async function tagProspectCampaign(
  prospectId: string,
  campaignId: string
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();
  const { error } = await supabase.from("prospect_campaigns").upsert(
    { prospect_id: prospectId, campaign_id: campaignId, added_by: user.id },
    { onConflict: "prospect_id,campaign_id" }
  );

  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}

export async function untagProspectCampaign(
  prospectId: string,
  campaignId: string
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("prospect_campaigns")
    .delete()
    .eq("prospect_id", prospectId)
    .eq("campaign_id", campaignId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}

export async function createOutreachCampaign(
  tenantSlug: string,
  input: { name: string; description?: string; business?: string }
): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("outreach_campaigns")
    .insert({
      tenant_slug: tenantSlug,
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      business: input.business?.trim() ?? null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };
  revalidatePath("/leads");
  return { success: true, id: data.id as string };
}
