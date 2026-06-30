"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

type ActionResult<T = unknown> =
  | ({ success: true } & (T extends void ? unknown : T))
  | { success: false; error: string };

export async function addProspectNote(
  tenantSlug: string,
  prospectId: string,
  body: string
): Promise<ActionResult<{ id: string }>> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const trimmed = body.trim();
  if (!trimmed) return { success: false, error: "Note cannot be empty" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("prospect_notes")
    .insert({
      tenant_slug: tenantSlug,
      prospect_id: prospectId,
      body: trimmed,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { success: false, error: error?.message ?? "Insert failed" };
  revalidatePath("/leads");
  return { success: true, id: data.id as string };
}

export async function deleteProspectNote(
  noteId: string
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("prospect_notes")
    .delete()
    .eq("id", noteId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}
