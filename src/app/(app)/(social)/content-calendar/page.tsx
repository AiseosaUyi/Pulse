import { getCurrentTenant } from "@/lib/auth";
import { listContentSlots } from "@/lib/services/content-calendar";
import { isContentCalendarEnabledForTenant } from "@/lib/content-calendar/tenant-config";
import ContentCalendarClient from "./client";

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
