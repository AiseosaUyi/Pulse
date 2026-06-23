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
    <div className="mx-auto w-full max-w-xl px-4 py-8 md:py-12">
      <h1 className="mb-4 text-2xl font-bold text-gray-1100 [font-family:'Satoshi-700',var(--font-sans)]">
        Today
      </h1>
      <CadenceRail tracker={tracker} tenantSlug={tenant.slug} />
    </div>
  );
}
