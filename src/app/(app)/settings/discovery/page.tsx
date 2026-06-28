import { redirect } from "next/navigation";
import { Radar } from "lucide-react";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { getEffectiveDiscoveryConfig } from "@/lib/actions/discovery";
import { SettingsPageHeading } from "../_shared";
import { DiscoveryClient } from "./client";

export const dynamic = "force-dynamic";

export default async function DiscoverySettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return (
      <div>
        <SettingsPageHeading
          icon={Radar}
          title="Discovery sources"
          subtitle="Owners and admins only."
        />
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <p className="text-sm text-text-muted max-w-md mx-auto">
            Discovery sources are managed by your workspace owner.
          </p>
        </div>
      </div>
    );
  }

  const config = await getEffectiveDiscoveryConfig();
  return (
    <div className="max-w-[760px]">
      <SettingsPageHeading
        icon={Radar}
        title="Discovery sources"
        subtitle="Platforms Pulse crawls nightly to find new prospects. Add the directories your audience hangs out on — ticketing sites, bar finders, booking apps — and matches surface as leads in Outbound."
      />
      <DiscoveryClient initial={config} />
    </div>
  );
}
