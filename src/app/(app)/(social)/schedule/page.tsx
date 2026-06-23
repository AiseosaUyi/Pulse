import { CalendarClock } from "lucide-react";
import { getCurrentTenant } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import ScheduleClient from "./client";

export default async function SchedulePage() {
  const tenant = await getCurrentTenant();
  const posts = tenant ? await fetchScheduledPosts(tenant.slug) : [];
  return <ScheduleClient initialPosts={posts} />;
}

async function fetchScheduledPosts(tenantSlug: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("scheduled_posts")
    .select("*")
    .eq("tenant_slug", tenantSlug)
    .in("status", ["scheduled", "publishing", "published", "failed"])
    .order("scheduled_for", { ascending: false })
    .limit(100);
  return data ?? [];
}
