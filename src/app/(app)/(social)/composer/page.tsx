// Composer — the daily-loop home. Two-pane on desktop: the composer (draft a
// take in your voice) + a cadence rail (today's windows, x/N, 7-day streak).
// On mobile the rail collapses to a compact "Today" link; the full tracker
// lives at /today.

import Link from "next/link";
import { getCurrentTenant } from "@/lib/auth";
import { getTracker } from "@/lib/services/cadence";
import { Composer } from "./client";
import { CadenceRail } from "./CadenceRail";

export const metadata = { title: "Composer" };

export default async function ComposerPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null; // (app)/layout already guarantees a membership
  const tracker = await getTracker(tenant.slug);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 md:py-12">
      {tracker && (
        <Link
          href="/today"
          className="mb-4 flex items-center justify-between rounded-2xl border border-white-200 bg-card px-4 py-3 text-sm lg:hidden"
        >
          <span className="text-gray-1000">
            Today{" "}
            <span className="font-bold text-gray-1100">
              {tracker.platforms.map((p) => `${p.posted}/${p.target} ${p.platform.toUpperCase()}`).join(" · ")}
            </span>
            {tracker.behind ? " — you're behind" : ""}
          </span>
          <span className="font-medium text-primary-500">View →</span>
        </Link>
      )}

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div className="lg:flex-1">
          <Composer tenantSlug={tenant.slug} />
        </div>
        <div className="hidden w-80 shrink-0 lg:block lg:sticky lg:top-8">
          <CadenceRail tracker={tracker} tenantSlug={tenant.slug} />
        </div>
      </div>
    </div>
  );
}
