import { redirect } from "next/navigation";
import { Plug } from "lucide-react";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { listIntegrations } from "@/lib/services/integrations";
import { listApiTokens } from "@/lib/actions/api-tokens";
import { listConnectedAccountsForTenant } from "@/lib/actions/composio";
import { getDriveConnectionStatus } from "@/lib/services/drive-connections";
import { IntegrationsClient } from "./client";
import { ApiTokensSection } from "./api-tokens";
import { ConnectedAccountsSection } from "./connected-accounts";
import { DriveSection } from "./drive-section";
import { SettingsPageHeading } from "../_shared";

interface PageProps {
  searchParams: Promise<{
    drive_connected?: string;
    drive_error?: string;
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
  const [integrations, apiTokens, connectedAccounts, driveStatus] =
    await Promise.all([
      listIntegrations(tenant.slug),
      listApiTokens(tenant.slug),
      listConnectedAccountsForTenant(tenant.slug),
      getDriveConnectionStatus(tenant.slug),
    ]);

  const driveFlash = params.drive_connected
    ? { kind: "success" as const, message: "Google Drive connected." }
    : params.drive_error
    ? {
        kind: "error" as const,
        message: `Drive connection failed: ${params.drive_error}`,
      }
    : null;

  return (
    <div className="max-w-[760px]">
      <SettingsPageHeading
        icon={Plug}
        title="Integrations"
        subtitle="Connect the tools Pulse pulls data from and manage API tokens for your own integrations. All credentials are stored securely."
      />
      <IntegrationsClient tenantSlug={tenant.slug} initial={integrations} />
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
        <ApiTokensSection tenantSlug={tenant.slug} initial={apiTokens} />
      </div>
    </div>
  );
}
