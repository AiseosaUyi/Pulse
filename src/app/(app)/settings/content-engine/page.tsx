import { redirect } from "next/navigation";
import { Film } from "lucide-react";
import { getCurrentUser, getCurrentTenant } from "@/lib/auth";
import { listForTenant } from "@/lib/services/content-format-templates";
import { SettingsPageHeading } from "../_shared";
import { ContentEngineClient } from "./_client";

export default async function ContentEngineSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/signup?step=company");

  if (tenant.role !== "owner" && tenant.role !== "admin") {
    return (
      <div>
        <SettingsPageHeading
          icon={Film}
          title="Content Engine"
          subtitle="Owners and admins only."
        />
        <div className="bg-card border border-border rounded-2xl p-8 text-center">
          <p className="text-sm text-text-muted max-w-md mx-auto">
            Format templates are managed by your workspace owner.
          </p>
        </div>
      </div>
    );
  }

  const templates = await listForTenant(tenant.slug, "video");

  return (
    <div className="max-w-[820px]">
      <SettingsPageHeading
        icon={Film}
        title="Content Engine"
        subtitle="Edit the video formats Pulse uses to generate content plans. Platform defaults are read-only — click 'Customize' to fork a copy you can tune for this workspace."
      />
      <ContentEngineClient
        tenantSlug={tenant.slug}
        initial={templates}
      />
    </div>
  );
}
