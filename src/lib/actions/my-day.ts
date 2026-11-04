"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentTenant, getCurrentUser } from "@/lib/auth";
import { getMyDay, type MyDayData } from "@/lib/services/my-day";

export async function fetchMyDayAction(owner = "all"): Promise<MyDayData | null> {
  const currentTenant = await getCurrentTenant();
  const user = await getCurrentUser();
  if (!currentTenant || !user) return null;
  const supabase = await createClient();
  return getMyDay(supabase, currentTenant.slug, {
    owner,
    currentUserId: user.id,
  });
}
