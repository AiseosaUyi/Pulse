"use server";

import { getCurrentTenant } from "@/lib/auth";
import { generateWeeklyDigest } from "@/lib/services/weekly-digest-generate";

/** Regenerate the weekly report for the viewer's own workspace. */
export async function regenerateWeeklyReportAction(): Promise<
  { success: true; digestId: string } | { success: false; error: string }
> {
  const tenant = await getCurrentTenant();
  if (!tenant || tenant.role === "support") return { success: false, error: "Not allowed" };
  const res = await generateWeeklyDigest(tenant.slug, { force: true });
  return res.success ? { success: true, digestId: res.digestId } : { success: false, error: res.error };
}
