import { requireTenantRole } from "@/lib/auth";
import { getFeatures } from "@/lib/features/server";
import { FEATURES, type FeatureDef, type FeatureKey } from "@/lib/features/registry";
import { FeatureToggle } from "@/components/features/FeatureSwitch";
import { SettingsPageHeading } from "../_shared";

function FeatureList({ items, features }: { items: FeatureDef[]; features: Record<FeatureKey, boolean> }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((f) => (
        <li key={f.key} className="flex items-center justify-between gap-4 py-3">
          <div>
            <p className="text-sm font-medium text-gray-1100 dark:text-foreground">{f.label}</p>
            <p className="text-xs text-gray-1000 dark:text-text-muted">{f.description}</p>
          </div>
          <FeatureToggle feature={f.key} on={features[f.key]} label={f.label} />
        </li>
      ))}
    </ul>
  );
}

export const dynamic = "force-dynamic";

export default async function FeaturesSettingsPage() {
  const tenant = await requireTenantRole(["owner", "admin"]);
  const features = await getFeatures(tenant.slug);
  const on = FEATURES.filter((f) => features[f.key]);
  const off = FEATURES.filter((f) => !features[f.key]);

  return (
    <div className="max-w-[760px] space-y-6">
      <SettingsPageHeading
        title="Features"
        subtitle={`Show only what ${tenant.name} uses. Switching a feature off hides it; nothing saved in it is deleted.`}
      />
      <section className="bg-card border border-border rounded-2xl px-6 py-3">
        <h2 className="pt-2 text-sm font-semibold text-gray-1100 dark:text-foreground">On ({on.length})</h2>
        {on.length ? <FeatureList items={on} features={features} /> : <p className="py-3 text-sm text-gray-1000">None.</p>}
      </section>
      <section className="bg-card border border-border rounded-2xl px-6 py-3">
        <h2 className="pt-2 text-sm font-semibold text-gray-1100 dark:text-foreground">Off ({off.length})</h2>
        {off.length ? <FeatureList items={off} features={features} /> : <p className="py-3 text-sm text-gray-1000">None.</p>}
      </section>
      <p className="text-xs text-gray-1000 dark:text-text-muted">
        Leads, Conversations and Today are always on.
      </p>
    </div>
  );
}
