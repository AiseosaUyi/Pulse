"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant, requireUser } from "@/lib/auth";

const LEAD_TYPES = ["venue", "sponsor", "partner", "influencer", "media"] as const;
const LEAD_STATUSES = ["new", "contacted", "warm", "cold", "converted"] as const;
const LEAD_VALUES = ["low", "medium", "high", "very_high"] as const;

function isOneOf<T extends readonly string[]>(list: T, v: unknown): v is T[number] {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function createLead(formData: FormData) {
  const user = await requireUser();
  const tenant = await getCurrentTenant();
  if (!tenant) return { success: false, error: "No tenant selected" };

  const name = str(formData, "name");
  const company = str(formData, "company") || null;
  const type = formData.get("type");
  const status = formData.get("status") ?? "new";
  const value = formData.get("value") ?? "medium";
  const nextAction = str(formData, "nextAction") || null;
  const lastContact = str(formData, "lastContact") || null;
  const notes = str(formData, "notes") || null;

  if (!name) return { success: false, error: "Name is required" };
  if (!isOneOf(LEAD_TYPES, type)) return { success: false, error: "Select a lead type" };
  if (!isOneOf(LEAD_STATUSES, status)) return { success: false, error: "Invalid status" };
  if (!isOneOf(LEAD_VALUES, value)) return { success: false, error: "Invalid value" };

  const supabase = await createClient();
  const { error } = await supabase.from("leads").insert({
    tenant_slug: tenant.slug,
    name,
    company,
    type,
    status,
    value,
    next_action: nextAction,
    last_contact: lastContact,
    notes,
    created_by: user.id,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath("/leads");
  return { success: true };
}

export async function updateLeadStatus(leadId: string, status: string) {
  await requireUser();
  if (!isOneOf(LEAD_STATUSES, status)) {
    return { success: false, error: "Invalid status" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ status })
    .eq("id", leadId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}

export async function deleteLead(leadId: string) {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("leads").delete().eq("id", leadId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/leads");
  return { success: true };
}
