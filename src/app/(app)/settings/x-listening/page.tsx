import { getCurrentTenant } from "@/lib/auth";
import { getXIntelConfig } from "@/lib/services/x-intel";
import { SettingsPageHeading } from "../_shared";
import { XListeningEditor } from "./client";

export const metadata = { title: "X Listening · Settings" };

export default async function XListeningPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) return null;

  const config = await getXIntelConfig(tenant.slug);

  return (
    <div className="max-w-[760px] space-y-6">
      <SettingsPageHeading
        title="X listening"
        subtitle={`Social topics and accounts Pulse monitors on X for ${tenant.name}. These are separate from SEO keywords — they surface tweets in Intel Feed → X Signals.`}
      />

      <section className="bg-card border border-border rounded-2xl p-6">
        <XListeningEditor tenantSlug={tenant.slug} initialConfig={config} />
      </section>
    </div>
  );
}
