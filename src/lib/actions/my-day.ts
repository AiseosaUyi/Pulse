"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant, getCurrentUser } from "@/lib/auth";
import { getMyDay, type MyDayData } from "@/lib/services/my-day";

export async function fetchMyDayAction(
  _tenantSlug?: string,
  owner = "all"
): Promise<MyDayData | null> {
  const user = await getCurrentUser();
  const currentTenant = await getCurrentTenant();
  if (!currentTenant) {
    throw new Error("No active tenant session found");
  }

  const supabase = await createClient();

  return getMyDay(supabase, currentTenant.slug, {
    owner,
    currentUserId: user?.id,
  });
}
