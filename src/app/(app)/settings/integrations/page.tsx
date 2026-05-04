import { redirect } from "next/navigation";
import { Plug } from "lucide-react";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { listIntegrations } from "@/lib/services/integrations";
import { listApiTokens } from "@/lib/actions/api-tokens";
import { listConnectedAccountsForTenant } from "@/lib/actions/composio";
import { IntegrationsClient } from "./client";
import { ApiTokensSection } from "./api-tokens";
import { ConnectedAccountsSection } from "./connected-accounts";
import { SettingsPageHeading } from "../_shared";

export default async function IntegrationsSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return (
      <div>
        <SettingsPageHeading
          icon={Plug}
          title="Integrations"
          subtitle="Owners and admins only."
        />
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <p className="text-sm text-text-muted max-w-md mx-auto">
            Integration credentials are managed by your workspace owner.
          </p>
        </div>
      </div>
    );
  }

  const [integrations, apiTokens, connectedAccounts] = await Promise.all([
    listIntegrations(tenant.slug),
    listApiTokens(tenant.slug),
    listConnectedAccountsForTenant(tenant.slug),
  ]);

  return (
    <div className="max-w-[760px]">
      <SettingsPageHeading
        icon={Plug}
        title="Integrations"
        subtitle="Connect data sources Pulse pulls from, plus API tokens for first-party clients. Credentials stay server-side — the browser never sees them."
      />
      <IntegrationsClient tenantSlug={tenant.slug} initial={integrations} />
      <div className="mt-6">
        <ConnectedAccountsSection
          tenantSlug={tenant.slug}
          initial={connectedAccounts}
        />
      </div>
      <div className="mt-6">
        <ApiTokensSection tenantSlug={tenant.slug} initial={apiTokens} />
      </div>
    </div>
  );
}
