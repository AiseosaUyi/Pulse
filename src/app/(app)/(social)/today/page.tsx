// Today — the full cadence tracker as its own surface (the mobile "Today"
// tab; also reachable on desktop). Reuses the CadenceRail component.

import { getCurrentTenant } from "@/lib/auth";
import { getTracker } from "@/lib/services/cadence";
import { CadenceRail } from "../composer/CadenceRail";

export const metadata = { title: "Today" };

export default async function TodayPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;
  const tracker = await getTracker(tenant.slug);

  return (
    <div className="p-4 md:p-8 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-foreground">Today</h1>
        <p className="text-sm text-text-secondary mt-1">Your posting beat for today.</p>
      </div>
      <div className="max-w-lg">
        <CadenceRail tracker={tracker} tenantSlug={tenant.slug} />
      </div>
    </div>
  );
}
