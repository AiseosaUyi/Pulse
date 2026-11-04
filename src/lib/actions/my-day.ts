"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant, getCurrentUser } from "@/lib/auth";
import { getMyDay, type MyDayData } from "@/lib/services/my-day";

export async function fetchMyDayAction(
  tenantSlug?: string,
  owner = "all"
): Promise<MyDayData | null> {
  const user = await getCurrentUser();
  const currentTenant = await getCurrentTenant();
  const slug = tenantSlug || currentTenant?.slug || "gruve";
  const supabase = await createClient();

  return getMyDay(supabase, slug, {
    owner,
    currentUserId: user?.id,
  });
}
