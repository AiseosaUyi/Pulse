import { getCurrentTenant } from "@/lib/auth";
import { listContentSlots } from "@/lib/services/content-calendar";
import { isContentCalendarEnabledForTenant } from "@/lib/content-calendar/tenant-config";
import ContentCalendarClient from "./client";

// The batch-generation server action does up to MAX_BATCH_SIZE slots x
// (1 topic-select call + 1 SERP search + 1 briefing call), concurrency-
// limited to 3. Confirmed live (2026-07-09): without this, the action was
// killed mid-run under real-world AI latency and returned a 503 to the
// client, with zero rows ever written — same pattern as blog-writer's
// generation page, same fix.
export const maxDuration = 300;

export default async function ContentCalendarPage() {
  const tenant = await getCurrentTenant();

  if (!tenant || !isContentCalendarEnabledForTenant(tenant.slug)) {
    return (
      <div className="p-4 md:p-8">
        <h1 className="text-2xl font-bold text-foreground">Content calendar</h1>
        <p className="text-text-secondary text-sm mt-2">
          Not available for this account yet.
        </p>
      </div>
    );
  }

  const slots = await listContentSlots(tenant.slug);
  return <ContentCalendarClient initialSlots={slots} />;
}
