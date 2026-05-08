"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { disconnectDrive } from "@/lib/services/drive-connections";

export async function disconnectDriveAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "No tenant" };
  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return { ok: false, error: "Owner/admin only" };
  }
  try {
    await disconnectDrive(tenant.slug);
    revalidatePath("/settings/integrations");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown",
    };
  }
}
