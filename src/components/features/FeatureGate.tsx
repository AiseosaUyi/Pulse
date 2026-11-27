import Link from "next/link";
import { getCurrentTenant } from "@/lib/auth";
import { getFeatures } from "@/lib/features/server";
import { featureDef, type FeatureKey } from "@/lib/features/registry";
import { TurnOnButton } from "./FeatureSwitch";

/**
 * Wraps a feature's pages. When the workspace switched the feature off, shows
 * a short note instead of the page. Nothing is deleted: switching it back on
 * shows the page with all its data.
 */
export async function FeatureGate({ feature, children }: { feature: FeatureKey; children: React.ReactNode }) {
  const tenant = await getCurrentTenant();
  if (!tenant) return <>{children}</>;
  const features = await getFeatures(tenant.slug);
  if (features[feature]) return <>{children}</>;

  const def = featureDef(feature);
  const canSwitch = tenant.role === "owner" || tenant.role === "admin";
  return (
    <div className="p-4 md:p-8">
      <div className="max-w-[560px] bg-card border border-border rounded-2xl p-8">
        <h1 className="text-xl font-semibold text-gray-1100 dark:text-foreground">{def.label} is switched off</h1>
        <p className="mt-2 text-sm text-gray-1000 dark:text-text-muted">{def.description}</p>
        <p className="mt-2 text-sm text-gray-1000 dark:text-text-muted">
          Anything saved here is kept. Switch it on to see it again.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {canSwitch ? (
            <TurnOnButton feature={feature} />
          ) : (
            <p className="text-sm text-gray-1000 dark:text-text-muted">Ask an owner or admin to switch it on.</p>
          )}
          <Link href="/settings/features" className="text-sm text-primary-500">
            All features
          </Link>
        </div>
      </div>
    </div>
  );
}
