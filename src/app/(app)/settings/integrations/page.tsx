import { redirect } from "next/navigation";
import { Plug } from "lucide-react";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { getTenant } from "@/lib/services/tenants";
import { listIntegrations } from "@/lib/services/integrations";
import { listApiTokens } from "@/lib/actions/api-tokens";
import { listConnectedAccountsForTenant } from "@/lib/actions/composio";
import { getDriveConnectionStatus } from "@/lib/services/drive-connections";
import { listAdAccountsForTenant } from "@/lib/services/ad-accounts";
import { listTikTokAdsConnectionsForTenant } from "@/lib/services/tiktok-ads-connections";
import { isTikTokAdsConfigured } from "@/lib/integrations/tiktok-ads";
import { IntegrationsClient } from "./client";
import { ApiTokensSection } from "./api-tokens";
import { ConnectedAccountsSection } from "./connected-accounts";
import { DriveSection } from "./drive-section";
import { AdsIntegrationsSection } from "./ads-integrations-section";
import { SiteDomainsSection } from "./site-domains-section";
import { SettingsPageHeading } from "../_shared";

interface PageProps {
  searchParams: Promise<{
    drive_connected?: string;
    drive_error?: string;
    connected?: string;
    error?: string;
  }>;
}

export default async function IntegrationsSettingsPage({
  searchParams,
}: PageProps) {
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

  const params = await searchParams;
  const [integrations, apiTokens, connectedAccounts, driveStatus, adAccounts, tiktokAdsConnections, tenantRecord] =
    await Promise.all([
      listIntegrations(tenant.slug),
      listApiTokens(tenant.slug),
      listConnectedAccountsForTenant(tenant.slug),
      getDriveConnectionStatus(tenant.slug),
      listAdAccountsForTenant(tenant.slug),
      listTikTokAdsConnectionsForTenant(tenant.slug),
      getTenant(tenant.slug),
    ]);

  const driveFlash = params.drive_connected
    ? { kind: "success" as const, message: "Google Drive connected." }
    : params.drive_error
    ? {
        kind: "error" as const,
        message: `Drive connection failed: ${params.drive_error}`,
      }
    : null;

  const adsFlash = params.connected
    ? { kind: "success" as const, message: `${params.connected === "tiktok_ads" ? "TikTok Ads" : params.connected} connected.` }
    : params.error
    ? { kind: "error" as const, message: `Connection failed: ${params.error}` }
    : null;

  const metaAdsConnections = connectedAccounts
    .filter((r) => r.toolkit === "metaads")
    .map((r) => ({ id: r.id, alias: r.alias, status: r.status, displayName: r.displayName }));

  // Contentful publishing silently works for a tenant with no
  // `tenant_integrations` row via the shared env-var fallback in
  // resolveContentfulConfig() (CLAUDE.md: intentional Gruve safety net).
  // The Settings form has no way to reflect that on its own, so tell the
  // server-side truth here and let the client component show an inline
  // note instead of implying nothing is configured.
  const hasContentfulRecord = integrations.some(
    (r) => r.provider === "contentful"
  );
  const contentfulUsingSharedFallback =
    !hasContentfulRecord &&
    Boolean(process.env.CONTENTFUL_SPACE_ID) &&
    Boolean(process.env.CONTENTFUL_CMA_TOKEN);

  return (
    <div className="max-w-[760px]">
      <SettingsPageHeading
        icon={Plug}
        title="Integrations"
        subtitle="Connect the tools Pulse pulls data from and manage API tokens for your own integrations. All credentials are stored securely."
      />
      <IntegrationsClient
        tenantSlug={tenant.slug}
        initial={integrations}
        contentfulUsingSharedFallback={contentfulUsingSharedFallback}
      />
      <div className="mt-6">
        <SiteDomainsSection
          initial={{
            domain: tenantRecord?.domain ?? "",
            stagingDomain: tenantRecord?.stagingDomain ?? "",
            blogPathPrefix: tenantRecord?.blogPathPrefix ?? "/blog",
          }}
        />
      </div>
      <div className="mt-6">
        <DriveSection status={driveStatus} flash={driveFlash} />
      </div>
      <div className="mt-6">
        <ConnectedAccountsSection
          tenantSlug={tenant.slug}
          initial={connectedAccounts}
        />
      </div>
      <div className="mt-6">
        <AdsIntegrationsSection
          tenantSlug={tenant.slug}
          metaConnections={metaAdsConnections}
          tiktokConnections={tiktokAdsConnections}
          tiktokConfigured={isTikTokAdsConfigured()}
          adAccounts={adAccounts}
          flash={adsFlash}
        />
      </div>
      <div className="mt-6">
        <ApiTokensSection tenantSlug={tenant.slug} initial={apiTokens} />
      </div>
    </div>
  );
}
